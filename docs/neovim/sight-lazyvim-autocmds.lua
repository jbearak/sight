-- Filetype detection and tree-sitter config for LazyVim
-- Add to: ~/.config/nvim/lua/config/autocmds.lua

-- Stata filetype detection
vim.filetype.add({
  extension = {
    ["do"] = "stata",
    ado = "stata",
    mata = "stata",
    doh = "stata",
  },
})

-- Tree-sitter parser configuration for Stata
vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  callback = function()
    local ok, parser_config = pcall(function()
      return require("nvim-treesitter.parsers").get_parser_configs()
    end)
    if ok then
      parser_config.stata = {
        install_info = {
          url = "https://github.com/jbearak/tree-sitter-stata",
          files = { "src/parser.c", "src/scanner.c" },
          branch = "main",
        },
        filetype = "stata",
      }
    end
  end,
})

-- Stata-specific auto-pairs for macros and compound quotes
vim.api.nvim_create_autocmd("FileType", {
  pattern = "stata",
  callback = function()
    -- ` produces `' (local macro delimiters)
    vim.keymap.set("i", "`", "`'<Left>", { buffer = true })
    -- `" produces `""' (compound string quotes)
    vim.keymap.set("i", '`"', '`""\'<Left><Left>', { buffer = true })
  end,
})
