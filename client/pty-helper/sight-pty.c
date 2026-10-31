/*
 * sight-pty: runs a command in a pseudo-terminal for sight console in
 * VS Code on macOS and Linux. The extension runs in Node, which can't
 * open a pseudo-terminal; this helper opens one, runs Stata in it, and
 * relays bytes over pipes. See src/console/helper-pty.ts for the Node
 * side and docs/superpowers/plans/2026-10-31-mac-console-pane.md.
 *
 * Usage: sight-pty COLS ROWS -- COMMAND [ARGS...]
 *
 * The terminal is not the command's controlling terminal (it runs in a
 * new session without one), as with Bun's PTY that `sight console`
 * uses elsewhere. With one, job control applies: after Stata's `shell`
 * the shell's process group can keep the terminal and Stata stops
 * (SIGTTIN) at its next read. So a typed ^C is just a byte, and the
 * helper signals the command itself for interrupt and resize.
 *
 * fd 0 (in):  bytes for the command's terminal.
 * fd 3 (in):  control lines: "W COLS ROWS" (resize, then SIGWINCH),
 *             "I" (SIGINT), "H" (SIGHUP, then SIGKILL after a grace
 *             period), "K" (SIGKILL now).
 * fd 1 (out): frames of 1 type byte, a 4-byte big-endian length and
 *             the payload, in order:
 *               'O'  bytes the command wrote;
 *               'L'  the terminal's c_lflag, in hex, whenever it
 *                    changes (and first, before any output);
 *               'E'  a failure message (if the helper itself failed,
 *                    no 'X' follows);
 *               'X'  "CODE SIGNAL" when the command ended (last frame).
 *
 * EOF on fd 0, or SIGHUP/SIGTERM to the helper, acts as "H".
 */

#if defined(__linux__)
#define _GNU_SOURCE
#endif

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#if defined(__APPLE__)
/* openpty is in libSystem; Zig's macOS headers lack <util.h>. */
int openpty(int *master, int *slave, char *name,
            struct termios *settings, struct winsize *size);
#else
#include <pty.h>
#endif

#define CONTROL_FD 3
#define READ_CHUNK_BYTES 65536
/* Stop reading a source while this much waits to be written. */
#define BUFFER_HIGH_BYTES (1024 * 1024)
#define HANGUP_GRACE_MS 2000
#define DRAIN_LIMIT_MS 200
#define POLL_BUSY_MS 20
#define POLL_IDLE_MS 100

struct buffer {
    char *data;
    size_t length;
    size_t capacity;
};

static int signal_pipe[2] = { -1, -1 };

static void die(const char *message)
{
    fprintf(stderr, "sight-pty: %s\n", message);
    exit(125);
}

static void buffer_append(struct buffer *buffer, const void *data,
                          size_t length)
{
    if (buffer->length + length > buffer->capacity) {
        size_t capacity = buffer->capacity ? buffer->capacity : 4096;
        while (capacity < buffer->length + length) {
            capacity *= 2;
        }
        char *grown = realloc(buffer->data, capacity);
        if (!grown) {
            die("out of memory");
        }
        buffer->data = grown;
        buffer->capacity = capacity;
    }
    memcpy(buffer->data + buffer->length, data, length);
    buffer->length += length;
}

static void buffer_consume(struct buffer *buffer, size_t length)
{
    memmove(buffer->data, buffer->data + length, buffer->length - length);
    buffer->length -= length;
}

static void append_frame(struct buffer *out, char type, const void *data,
                         size_t length)
{
    unsigned char header[5];
    header[0] = (unsigned char)type;
    header[1] = (unsigned char)(length >> 24);
    header[2] = (unsigned char)(length >> 16);
    header[3] = (unsigned char)(length >> 8);
    header[4] = (unsigned char)length;
    buffer_append(out, header, sizeof header);
    buffer_append(out, data, length);
}

static void append_text_frame(struct buffer *out, char type,
                              const char *text)
{
    append_frame(out, type, text, strlen(text));
}

/* Write what fits; returns -1 if the reader is gone. */
static int flush_some(int fd, struct buffer *buffer)
{
    while (buffer->length > 0) {
        ssize_t written = write(fd, buffer->data, buffer->length);
        if (written > 0) {
            buffer_consume(buffer, (size_t)written);
            continue;
        }
        if (written < 0 && errno == EINTR) {
            continue;
        }
        if (written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            return 0;
        }
        return -1;
    }
    return 0;
}

/* At exit: write everything, waiting as needed. */
static void flush_all(int fd, struct buffer *buffer)
{
    while (buffer->length > 0) {
        if (flush_some(fd, buffer) < 0) {
            return;
        }
        if (buffer->length > 0) {
            struct pollfd one = { fd, POLLOUT, 0 };
            if (poll(&one, 1, 1000) <= 0 && errno != EINTR) {
                return;
            }
        }
    }
}

static void set_nonblocking(int fd)
{
    int flags = fcntl(fd, F_GETFL);
    if (flags >= 0) {
        fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    }
}

static void set_cloexec(int fd)
{
    int flags = fcntl(fd, F_GETFD);
    if (flags >= 0) {
        fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
    }
}

static int64_t now_ms(void)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static void on_signal(int signal_number)
{
    int saved_errno = errno;
    char byte = signal_number == SIGCHLD ? 'C' : 'H';
    ssize_t ignored = write(signal_pipe[1], &byte, 1);
    (void)ignored;
    errno = saved_errno;
}

static void install_handler(int signal_number)
{
    struct sigaction action;
    memset(&action, 0, sizeof action);
    action.sa_handler = on_signal;
    sigemptyset(&action.sa_mask);
    action.sa_flags = SA_RESTART;
    sigaction(signal_number, &action, NULL);
}

static int parse_size(const char *text)
{
    char *end = NULL;
    long value = strtol(text, &end, 10);
    if (!end || *end != '\0' || value < 1 || value > 10000) {
        return -1;
    }
    return (int)value;
}

#define FALLBACK_MAX_FD 1024

/*
 * Close every fd above stderr except `keep`. Leaked fds (such as
 * another program's pipes) would otherwise pass to Stata and anything
 * it leaves running, holding those pipes open.
 */
static void close_other_fds(int keep)
{
    int the_fds[FALLBACK_MAX_FD];
    int count = 0;
    DIR *listing = opendir("/dev/fd");
    if (listing) {
        struct dirent *entry;
        while ((entry = readdir(listing)) != NULL
               && count < FALLBACK_MAX_FD) {
            int fd = atoi(entry->d_name);
            if (fd > STDERR_FILENO && fd != keep
                && fd != dirfd(listing)) {
                the_fds[count++] = fd;
            }
        }
        closedir(listing);
        for (int i = 0; i < count; i++) {
            close(the_fds[i]);
        }
        return;
    }
    for (int fd = STDERR_FILENO + 1; fd < FALLBACK_MAX_FD; fd++) {
        if (fd != keep) {
            close(fd);
        }
    }
}

/* The child: a new session with the terminal as stdio, then exec. */
static void run_child(char **command, int slave, int exec_status_fd)
{
    signal(SIGPIPE, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    signal(SIGTERM, SIG_DFL);
    signal(SIGCHLD, SIG_DFL);
    setsid();
    dup2(slave, STDIN_FILENO);
    dup2(slave, STDOUT_FILENO);
    dup2(slave, STDERR_FILENO);
    close_other_fds(exec_status_fd);
    execvp(command[0], command);
    int error_number = errno;
    ssize_t ignored = write(exec_status_fd, &error_number,
                            sizeof error_number);
    (void)ignored;
    _exit(127);
}

int main(int argc, char **argv)
{
    if (argc < 5 || strcmp(argv[3], "--") != 0) {
        fprintf(stderr,
                "usage: sight-pty COLS ROWS -- COMMAND [ARGS...]\n");
        return 2;
    }
    int columns = parse_size(argv[1]);
    int rows = parse_size(argv[2]);
    if (columns < 0 || rows < 0) {
        fprintf(stderr, "sight-pty: bad terminal size\n");
        return 2;
    }
    char **command = argv + 4;

    signal(SIGPIPE, SIG_IGN);
    if (pipe(signal_pipe) != 0) {
        die("cannot create a pipe");
    }
    set_cloexec(signal_pipe[0]);
    set_cloexec(signal_pipe[1]);
    set_nonblocking(signal_pipe[0]);
    set_nonblocking(signal_pipe[1]);
    set_cloexec(CONTROL_FD);
    install_handler(SIGCHLD);
    install_handler(SIGHUP);
    install_handler(SIGTERM);

    int exec_status[2];
    if (pipe(exec_status) != 0) {
        die("cannot create a pipe");
    }
    set_cloexec(exec_status[0]);
    set_cloexec(exec_status[1]);

    struct buffer out = { NULL, 0, 0 };
    struct buffer to_child = { NULL, 0, 0 };
    struct buffer control = { NULL, 0, 0 };

    struct winsize size;
    memset(&size, 0, sizeof size);
    size.ws_col = (unsigned short)columns;
    size.ws_row = (unsigned short)rows;
    int master = -1;
    int slave = -1;
    pid_t child = -1;
    if (openpty(&master, &slave, NULL, NULL, &size) == 0) {
        /* Echo off: the console draws what the user types itself. */
        struct termios settings;
        if (tcgetattr(slave, &settings) == 0) {
            settings.c_lflag &= ~(tcflag_t)ECHO;
            tcsetattr(slave, TCSANOW, &settings);
        }
        set_cloexec(master);
        child = fork();
    }
    if (child < 0) {
        char message[256];
        snprintf(message, sizeof message,
                 "cannot open a pseudo-terminal: %s", strerror(errno));
        append_text_frame(&out, 'E', message);
        flush_all(STDOUT_FILENO, &out);
        return 1;
    }
    if (child == 0) {
        close(exec_status[0]);
        run_child(command, slave, exec_status[1]);
    }
    close(exec_status[1]);
    close(slave);

    /* EOF means exec succeeded (the pipe closed on exec). */
    int exec_error = 0;
    ssize_t got;
    do {
        got = read(exec_status[0], &exec_error, sizeof exec_error);
    } while (got < 0 && errno == EINTR);
    close(exec_status[0]);

    set_nonblocking(master);
    set_nonblocking(STDIN_FILENO);
    set_nonblocking(STDOUT_FILENO);
    set_nonblocking(CONTROL_FD);

    if (got == (ssize_t)sizeof exec_error) {
        char message[512];
        snprintf(message, sizeof message, "cannot run %s: %s",
                 command[0], strerror(exec_error));
        append_text_frame(&out, 'E', message);
    }

    unsigned long last_flags = 0;
    int have_flags = 0;
    int child_done = 0;
    int child_status = 0;
    int master_open = 1;
    int stdin_open = 1;
    int control_open = 1;
    int hangup_sent = 0;
    int64_t kill_at_ms = -1;
    char chunk[READ_CHUNK_BYTES];

#define REPORT_FLAGS() do { \
        struct termios current_; \
        if (master_open && tcgetattr(master, &current_) == 0) { \
            unsigned long flags_ = (unsigned long)current_.c_lflag; \
            if (!have_flags || flags_ != last_flags) { \
                char text_[32]; \
                snprintf(text_, sizeof text_, "%lx", flags_); \
                append_text_frame(&out, 'L', text_); \
                last_flags = flags_; \
                have_flags = 1; \
            } \
        } \
    } while (0)

#define HANG_UP() do { \
        if (!hangup_sent && !child_done) { \
            hangup_sent = 1; \
            kill(child, SIGHUP); \
            kill_at_ms = now_ms() + HANGUP_GRACE_MS; \
        } \
    } while (0)

    REPORT_FLAGS();

    while (!child_done) {
        struct pollfd fds[5];
        int count = 0;
        int master_index = -1, stdin_index = -1, stdout_index = -1;
        int control_index = -1, signal_index;

        if (master_open) {
            short events = 0;
            if (out.length < BUFFER_HIGH_BYTES) {
                events |= POLLIN;
            }
            if (to_child.length > 0) {
                events |= POLLOUT;
            }
            master_index = count;
            fds[count++] = (struct pollfd){ master, events, 0 };
        }
        if (stdin_open && to_child.length < BUFFER_HIGH_BYTES) {
            stdin_index = count;
            fds[count++] = (struct pollfd){ STDIN_FILENO, POLLIN, 0 };
        }
        if (out.length > 0) {
            stdout_index = count;
            fds[count++] = (struct pollfd){ STDOUT_FILENO, POLLOUT, 0 };
        }
        if (control_open) {
            control_index = count;
            fds[count++] = (struct pollfd){ CONTROL_FD, POLLIN, 0 };
        }
        signal_index = count;
        fds[count++] = (struct pollfd){ signal_pipe[0], POLLIN, 0 };

        int timeout_ms = to_child.length > 0 ? POLL_BUSY_MS : POLL_IDLE_MS;
        if (kill_at_ms >= 0) {
            int64_t left_ms = kill_at_ms - now_ms();
            if (left_ms < timeout_ms) {
                timeout_ms = left_ms > 0 ? (int)left_ms : 0;
            }
        }
        int ready = poll(fds, (nfds_t)count, timeout_ms);
        if (ready < 0 && errno != EINTR) {
            die("poll failed");
        }

        if (ready > 0 && fds[signal_index].revents) {
            char bytes[64];
            ssize_t n;
            while ((n = read(signal_pipe[0], bytes, sizeof bytes)) > 0) {
                for (ssize_t i = 0; i < n; i++) {
                    if (bytes[i] == 'H') {
                        HANG_UP();
                    }
                }
            }
        }
        int status;
        if (waitpid(child, &status, WNOHANG) == child) {
            child_done = 1;
            child_status = status;
        }

        if (ready > 0 && master_index >= 0) {
            short revents = fds[master_index].revents;
            if (revents & POLLIN) {
                ssize_t n = read(master, chunk, sizeof chunk);
                if (n > 0) {
                    REPORT_FLAGS();
                    append_frame(&out, 'O', chunk, (size_t)n);
                } else if (n == 0
                           || (errno != EAGAIN && errno != EINTR)) {
                    master_open = 0;
                }
            } else if (revents & (POLLHUP | POLLERR)) {
                /* Linux: POLLHUP once every slave fd closed. */
                if (!(revents & POLLOUT)) {
                    ssize_t n = read(master, chunk, sizeof chunk);
                    if (n > 0) {
                        REPORT_FLAGS();
                        append_frame(&out, 'O', chunk, (size_t)n);
                    } else if (n == 0 || errno != EAGAIN) {
                        master_open = 0;
                    }
                }
            }
            if (master_open && (revents & POLLOUT)) {
                if (flush_some(master, &to_child) < 0) {
                    to_child.length = 0;
                }
            }
        }

        if (ready > 0 && stdin_index >= 0 && fds[stdin_index].revents) {
            ssize_t n = read(STDIN_FILENO, chunk, sizeof chunk);
            if (n > 0) {
                buffer_append(&to_child, chunk, (size_t)n);
                if (master_open) {
                    if (flush_some(master, &to_child) < 0) {
                        to_child.length = 0;
                    }
                }
            } else if (n == 0 || (errno != EAGAIN && errno != EINTR)) {
                stdin_open = 0;
                HANG_UP();
            }
        }

        if (ready > 0 && control_index >= 0
            && fds[control_index].revents) {
            ssize_t n = read(CONTROL_FD, chunk, sizeof chunk);
            if (n > 0) {
                buffer_append(&control, chunk, (size_t)n);
                char *newline;
                while ((newline = memchr(control.data, '\n',
                                         control.length)) != NULL) {
                    size_t line_length = (size_t)(newline - control.data);
                    char line[64];
                    if (line_length < sizeof line) {
                        memcpy(line, control.data, line_length);
                        line[line_length] = '\0';
                        int new_columns, new_rows;
                        if (line[0] == 'W'
                            && sscanf(line + 1, "%d %d", &new_columns,
                                      &new_rows) == 2
                            && new_columns > 0 && new_rows > 0
                            && master_open) {
                            struct winsize new_size;
                            memset(&new_size, 0, sizeof new_size);
                            new_size.ws_col = (unsigned short)new_columns;
                            new_size.ws_row = (unsigned short)new_rows;
                            ioctl(master, TIOCSWINSZ, &new_size);
                            if (!child_done) {
                                kill(child, SIGWINCH);
                            }
                        } else if (line[0] == 'I' && !child_done) {
                            kill(child, SIGINT);
                        } else if (line[0] == 'H') {
                            HANG_UP();
                        } else if (line[0] == 'K' && !child_done) {
                            kill(child, SIGKILL);
                        }
                    }
                    buffer_consume(&control, line_length + 1);
                }
            } else if (n == 0 || (errno != EAGAIN && errno != EINTR)) {
                /* Without control, input EOF still ends the child. */
                control_open = 0;
            }
        }

        if (ready > 0 && stdout_index >= 0
            && fds[stdout_index].revents) {
            if (flush_some(STDOUT_FILENO, &out) < 0) {
                /* Nobody reads us any more: end the child. */
                out.length = 0;
                HANG_UP();
            }
        }

        if (ready == 0) {
            REPORT_FLAGS();
        }
        if (kill_at_ms >= 0 && !child_done && now_ms() >= kill_at_ms) {
            kill(child, SIGKILL);
            kill_at_ms = -1;
        }
    }

    /* Read what's left. A background process can keep the terminal
     * open, so stop after a short while. */
    int64_t drain_until_ms = now_ms() + DRAIN_LIMIT_MS;
    while (master_open && now_ms() < drain_until_ms) {
        ssize_t n = read(master, chunk, sizeof chunk);
        if (n > 0) {
            append_frame(&out, 'O', chunk, (size_t)n);
            continue;
        }
        if (n < 0 && errno == EINTR) {
            continue;
        }
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            struct pollfd one = { master, POLLIN, 0 };
            int64_t left_ms = drain_until_ms - now_ms();
            if (left_ms <= 0 || poll(&one, 1, (int)left_ms) <= 0) {
                break;
            }
            continue;
        }
        break;
    }

    char exit_text[32];
    int exit_code = WIFEXITED(child_status) ? WEXITSTATUS(child_status) : 0;
    int exit_signal = WIFSIGNALED(child_status) ? WTERMSIG(child_status) : 0;
    snprintf(exit_text, sizeof exit_text, "%d %d", exit_code, exit_signal);
    append_text_frame(&out, 'X', exit_text);
    int flags = fcntl(STDOUT_FILENO, F_GETFL);
    if (flags >= 0) {
        fcntl(STDOUT_FILENO, F_SETFL, flags & ~O_NONBLOCK);
    }
    flush_all(STDOUT_FILENO, &out);
    if (exit_signal) {
        return 128 + exit_signal;
    }
    return exit_code;
}
