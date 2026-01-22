-- Sight LSP configuration for LazyVim / lazy.nvim
-- Copy to: ~/.config/nvim/lua/plugins/stata.lua

vim.filetype.add({
  extension = {
    ["do"] = "stata",
    ado = "stata",
    mata = "stata",
    doh = "stata",
  },
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = "stata",
  callback = function()
    vim.lsp.start({
      name = "sight",
      cmd = { "sight-language-server", "--stdio" },
      root_dir = vim.fn.getcwd(),
    })
  end,
})

return {}
