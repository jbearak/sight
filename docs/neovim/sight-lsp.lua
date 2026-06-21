-- Sight LSP configuration for standard Neovim (without lazy.nvim)
-- Add to: ~/.config/nvim/init.lua or ~/.config/nvim/lua/plugins/stata.lua

local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- Register Stata filetype
vim.filetype.add({
  extension = {
    ["do"] = 'stata',
    ado = 'stata',
    mata = 'stata',
    doh = 'stata',
  },
})

-- Define the Sight language server configuration
if not configs.sight then
  configs.sight = {
    default_config = {
      cmd = { 'sight', '--stdio' },
      filetypes = { 'stata' },
      root_dir = function(fname)
        return lspconfig.util.root_pattern('.sight.json', '.git')(fname)
          or lspconfig.util.path.dirname(fname)
      end,
      settings = {},
    },
  }
end

-- Enable the server
lspconfig.sight.setup({
  settings = {
    sight = {
      diagnostics = {
        enabled = true,
        indentation = false,
      },
    },
  },
})
