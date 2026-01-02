# Design Document: Logging Refactor

## Overview

This design introduces a centralized Logger service that routes all production logs through the LSP client's log channel. The Logger is a singleton that can be configured with different verbosity levels and provides a consistent interface for all logging needs. It maintains backward compatibility by using console.debug as a fallback when no log channel is provided (for CLI/tests).

## Architecture

```
Production Code (src/)
    ↓
Logger (singleton)
    ├─ Verbosity Filter (debug/info/warn/error)
    ├─ Message Formatter (timestamp + level + message)
    └─ Log Channel Callback
        ↓
    LSP Client (connection.console.log)
        ↓
    VS Code Output Channel
```

The Logger sits between production code and the LSP client, providing:
- Centralized configuration point
- Consistent message formatting
- Verbosity control
- Fallback to console.debug when no channel is provided

## Components and Interfaces

### Logger Service

**File**: `src/utils/logger.ts`

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogChannelCallback = (message: string) => void;

interface LoggerConfig {
    verbosity?: LogLevel;
    channel?: LogChannelCallback;
}

class Logger {
    private static instance: Logger;
    private verbosity: LogLevel = 'info';
    private channel: LogChannelCallback;
    
    private constructor(config?: LoggerConfig);
    
    static initialize(config?: LoggerConfig): void;
    static getInstance(): Logger;
    
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    
    private shouldLog(level: LogLevel): boolean;
    private formatMessage(level: LogLevel, message: string): string;
}

export const logger = Logger.getInstance();
```

### Logger Initialization

The Logger is initialized in `server.ts` during the `onInitialized` handler:

```typescript
connection.onInitialized(() => {
    // Initialize Logger with LSP client channel
    Logger.initialize({
        verbosity: 'info',
        channel: (msg) => connection.console.log(msg),
    });
    
    // ... rest of initialization
});
```

### Verbosity Levels

The Logger supports four verbosity levels with the following behavior:

| Level | Output | Use Case |
|-------|--------|----------|
| debug | debug, info, warn, error | Development/troubleshooting |
| info | info, warn, error | Default production |
| warn | warn, error | Minimal logging |
| error | error | Critical errors only |

## Data Models

### Log Message Format

```typescript
interface FormattedLogMessage {
    timestamp: string;      // ISO 8601 format
    level: LogLevel;        // debug, info, warn, error
    message: string;        // User message
}
```

Example output:
```
[2024-01-15T10:30:45.123Z] [INFO] Loaded command cache v18 with 500 commands
[2024-01-15T10:30:46.456Z] [WARN] High backpressure detected. Dropped 5 parses.
[2024-01-15T10:30:47.789Z] [ERROR] Failed to index file: ENOENT
```

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Verbosity Filtering

*For any* log message and any verbosity level, if the message's level is less severe than the configured verbosity, the message SHALL NOT be output.

**Validates: Requirements 5.2, 5.3, 5.4**

### Property 2: Message Formatting

*For any* log message, the formatted output SHALL contain a timestamp in ISO 8601 format, the log level in uppercase, and the original message text.

**Validates: Requirements 1.3**

### Property 3: Fallback Logging

*For any* Logger instance without a configured log channel, messages SHALL be output to console.debug without throwing an error.

**Validates: Requirements 1.4, 6.1**

### Property 4: Singleton Instance

*For any* two calls to Logger.getInstance(), the returned instances SHALL be identical (same object reference).

**Validates: Requirements 1.5**

### Property 5: Channel Callback Error Handling

*For any* log message, if the log channel callback throws an error, the Logger SHALL catch the error and continue operation without propagating the exception.

**Validates: Requirements 7.1**

### Property 6: Message Formatting Error Handling

*For any* log message that cannot be formatted, the Logger SHALL output a fallback message containing the original message text.

**Validates: Requirements 7.2**

## Error Handling

The Logger handles errors gracefully:

1. **Channel Callback Errors**: If `channel(message)` throws, the error is caught and logged to console.error
2. **Formatting Errors**: If message formatting fails, a fallback message is used
3. **Null/Undefined Messages**: Empty messages are handled gracefully with a placeholder

Example error handling:
```typescript
try {
    this.channel(formatted_message);
} catch (error) {
    console.error(`Logger channel error: ${error}`);
}
```

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Verbosity Filtering**: Test each verbosity level filters correctly
2. **Message Formatting**: Test timestamp and level are included
3. **Fallback Logging**: Test console.debug is used when no channel provided
4. **Singleton Pattern**: Test getInstance returns same instance
5. **Error Handling**: Test channel errors are caught and logged
6. **Edge Cases**: Test null/undefined messages, empty strings

### Property-Based Tests

Property-based tests verify universal properties across all inputs:

1. **Property 1: Verbosity Filtering** - Generate random log levels and messages, verify filtering
2. **Property 2: Message Formatting** - Generate random messages, verify format includes timestamp and level
3. **Property 3: Fallback Logging** - Generate random messages without channel, verify console.debug is called
4. **Property 4: Singleton Instance** - Verify getInstance always returns same instance
5. **Property 5: Channel Error Handling** - Generate channel callbacks that throw, verify errors are caught
6. **Property 6: Message Formatting Error Handling** - Generate messages that might fail formatting, verify fallback

### Test Configuration

- Minimum 100 iterations per property test
- Tests use fast-check for property-based testing
- Unit tests co-located with source in `tests/unit/logger.test.ts`
- Property tests in `tests/property/logger.property.test.ts`

## Migration Path

### Phase 1: Logger Implementation
- Create Logger service in `src/utils/logger.ts`
- Write unit and property tests
- Initialize Logger in server.ts

### Phase 2: Module Updates
- Update `src/indexer/index.ts` to use Logger
- Update `src/comment-processor/comment-processor.ts` to use Logger
- Update `src/scope-resolver/index.ts` to use Logger
- Update `src/utils/debounce-manager.ts` to use Logger
- Update `src/providers/formatter.ts` to use Logger

### Phase 3: Verification
- Verify all tests pass
- Verify no console.* calls remain in production code (except server.ts)
- Verify scripts and tests are unaffected

## Notes

- The Logger uses a singleton pattern to ensure consistent configuration across the application
- Verbosity defaults to "info" to follow the Python Language Server pattern
- The Logger is initialized in server.ts to ensure the LSP client connection is available
- Fallback to console.debug ensures the Logger works in CLI/test environments
- All error handling is defensive to prevent logging from crashing the application
