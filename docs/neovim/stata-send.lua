-- stata-send.lua
-- Send code to Stata on macOS via AppleScript
-- Copy to: ~/.config/nvim/lua/stata-send.lua

local M = {}

-- Stata application variants in order of preference
local stata_apps = { "StataMP", "StataSE", "StataBE", "Stata" }

-- Find the first available Stata application
local function find_stata_app()
  for _, app in ipairs(stata_apps) do
    local path = "/Applications/Stata/" .. app .. ".app"
    if vim.fn.isdirectory(path) == 1 then
      return app
    end
  end
  return nil
end

-- Escape a string for use in AppleScript
local function escape_applescript(str)
  return str:gsub("\\", "\\\\"):gsub('"', '\\"')
end

-- Send a command to Stata via AppleScript
local function send_to_stata(stata_app, command, filepath)
  local escaped_path = escape_applescript(filepath)
  local applescript = string.format(
    'tell application "%s" to DoCommandAsync "%s \\"%s\\""',
    stata_app,
    command,
    escaped_path
  )
  -- Escape single quotes for shell
  local shell_safe = applescript:gsub("'", "'\\''")
  local cmd = string.format("osascript -e '%s'", shell_safe)

  vim.fn.jobstart(cmd, {
    on_stderr = function(_, data)
      if data and data[1] ~= "" then
        vim.notify("Stata error: " .. table.concat(data, "\n"), vim.log.levels.ERROR)
      end
    end,
  })
end

-- Send a raw Stata command (for cd)
local function send_raw_command(stata_app, stata_command)
  local escaped_cmd = escape_applescript(stata_command)
  local applescript = string.format(
    'tell application "%s" to DoCommandAsync "%s"',
    stata_app,
    escaped_cmd
  )
  local shell_safe = applescript:gsub("'", "'\\''")
  local cmd = string.format("osascript -e '%s'", shell_safe)

  vim.fn.jobstart(cmd, {
    on_stderr = function(_, data)
      if data and data[1] ~= "" then
        vim.notify("Stata error: " .. table.concat(data, "\n"), vim.log.levels.ERROR)
      end
    end,
  })
end

-- Check if a line ends with /// continuation
local function ends_with_continuation(line)
  if type(line) ~= "string" then
    return false
  end
  return line:match("///") ~= nil
end

-- Detect the full statement bounds around a line (handles /// continuations)
-- Returns start_line, end_line (1-indexed, inclusive)
local function detect_statement(line)
  local start_line = line
  local end_line = line
  local line_count = vim.api.nvim_buf_line_count(0)

  -- Search backwards for statement start
  while start_line > 1 do
    local prev_line_result = vim.api.nvim_buf_get_lines(0, start_line - 2, start_line - 1, false)
    local prev_line = prev_line_result[1] or ""
    if not ends_with_continuation(prev_line) then
      break
    end
    start_line = start_line - 1
  end

  -- Search forwards for statement end
  while end_line < line_count do
    local current_line_result = vim.api.nvim_buf_get_lines(0, end_line - 1, end_line, false)
    local current_line = current_line_result[1] or ""
    if not ends_with_continuation(current_line) then
      break
    end
    end_line = end_line + 1
  end

  return start_line, end_line
end

-- Get upward bounds (from start of file to current statement end)
local function get_upward_bounds(line)
  local line_count = vim.api.nvim_buf_line_count(0)
  local end_line = line

  -- If cursor line has continuation, extend to include complete statement
  while end_line < line_count do
    local current_line_result = vim.api.nvim_buf_get_lines(0, end_line - 1, end_line, false)
    local current_line = current_line_result[1] or ""
    if not ends_with_continuation(current_line) then
      break
    end
    end_line = end_line + 1
  end

  return 1, end_line
end

-- Get downward bounds (from current statement start to end of file)
local function get_downward_bounds(line)
  local line_count = vim.api.nvim_buf_line_count(0)
  local start_line = line

  -- If cursor is on a continuation line, find statement start
  while start_line > 1 do
    local prev_line_result = vim.api.nvim_buf_get_lines(0, start_line - 2, start_line - 1, false)
    local prev_line = prev_line_result[1] or ""
    if not ends_with_continuation(prev_line) then
      break
    end
    start_line = start_line - 1
  end

  return start_line, line_count
end

-- Get the current line or visual selection
local function get_text()
  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    -- Visual mode: get selection
    local start_pos = vim.fn.getpos("v")
    local end_pos = vim.fn.getpos(".")
    local start_line = start_pos[2]
    local end_line = end_pos[2]
    if start_line > end_line then
      start_line, end_line = end_line, start_line
    end
    local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
    -- Exit visual mode
    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "n", false)
    return table.concat(lines, "\n")
  else
    -- Normal mode: detect full statement around current line
    local current_line = vim.fn.line(".")
    local start_line, end_line = detect_statement(current_line)
    local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
    return table.concat(lines, "\n")
  end
end

-- Get lines from a range (for command with range support)
local function get_range_text(line1, line2)
  local lines = vim.api.nvim_buf_get_lines(0, line1 - 1, line2, false)
  return table.concat(lines, "\n")
end

-- Get lines from start of file to current statement
local function get_upward_lines()
  local current_line = vim.fn.line(".")
  local start_line, end_line = get_upward_bounds(current_line)
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  return table.concat(lines, "\n")
end

-- Get lines from current statement to end of file
local function get_downward_lines()
  local current_line = vim.fn.line(".")
  local start_line, end_line = get_downward_bounds(current_line)
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  return table.concat(lines, "\n")
end

-- Create a temporary .do file with the given content
local function create_temp_file(content)
  local tmpfile = vim.fn.tempname() .. ".do"

  local file, err = io.open(tmpfile, "w")
  if not file then
    vim.notify(
      "Failed to create temporary file: " .. (err or "unknown error"),
      vim.log.levels.ERROR
    )
    return nil
  end

  local success, write_err = pcall(function()
    file:write(content)
  end)
  file:close()

  if not success then
    vim.fn.delete(tmpfile)
    vim.notify(
      "Failed to write to temporary file: " .. (write_err or "unknown error"),
      vim.log.levels.ERROR
    )
    return nil
  end

  return tmpfile
end

-- Send line or selection to Stata (for keybindings)
function M.send(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_text()
  if not text or text == "" then
    vim.notify("No text to send", vim.log.levels.WARN)
    return
  end

  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send range to Stata (for commands with range support)
function M.send_range(command, line1, line2)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_range_text(line1, line2)
  if not text or text == "" then
    vim.notify("No text to send", vim.log.levels.WARN)
    return
  end

  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send from start of file to current line
function M.send_upward(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_upward_lines()
  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send from current line to end of file
function M.send_downward(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_downward_lines()
  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send entire file to Stata
function M.send_file(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  -- Save the file first
  local ok, err = pcall(vim.cmd, "write")
  if not ok then
    vim.notify("Failed to save file: " .. tostring(err), vim.log.levels.ERROR)
    return
  end

  local filepath = vim.fn.expand("%:p")
  if filepath == "" then
    vim.notify("No file to send", vim.log.levels.WARN)
    return
  end

  send_to_stata(stata_app, command, filepath)
end

-- Change Stata's working directory to the file's directory
function M.cd_file()
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local dir = vim.fn.expand("%:p:h")
  if dir == "" then
    vim.notify("No file directory available", vim.log.levels.WARN)
    return
  end

  local escaped_dir = escape_applescript(dir)
  send_raw_command(stata_app, 'cd `"' .. escaped_dir .. "\"'")
end

-- Change Stata's working directory to the workspace root
function M.cd_workspace()
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local dir = vim.fn.getcwd()
  local escaped_dir = escape_applescript(dir)
  send_raw_command(stata_app, 'cd `"' .. escaped_dir .. "\"'")
end

-- Register user commands
function M.setup()
  vim.api.nvim_create_user_command("SightDo", function(opts)
    M.send_range("do", opts.line1, opts.line2)
  end, { desc = "Sight: Do line or selection", range = true })

  vim.api.nvim_create_user_command("SightDoUpwardLines", function()
    M.send_upward("do")
  end, { desc = "Sight: Do upward lines" })

  vim.api.nvim_create_user_command("SightDoDownwardLines", function()
    M.send_downward("do")
  end, { desc = "Sight: Do downward lines" })

  vim.api.nvim_create_user_command("SightDoFile", function()
    M.send_file("do")
  end, { desc = "Sight: Do file" })

  vim.api.nvim_create_user_command("SightInclude", function(opts)
    M.send_range("include", opts.line1, opts.line2)
  end, { desc = "Sight: Include line or selection", range = true })

  vim.api.nvim_create_user_command("SightIncludeFile", function()
    M.send_file("include")
  end, { desc = "Sight: Include file" })

  vim.api.nvim_create_user_command("SightCdFile", function()
    M.cd_file()
  end, { desc = "Sight: CD to file directory" })

  vim.api.nvim_create_user_command("SightCdWorkspace", function()
    M.cd_workspace()
  end, { desc = "Sight: CD to workspace directory" })
end

return M
