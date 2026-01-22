-- Sight LSP configuration for LazyVim / lazy.nvim
-- Copy to: ~/.config/nvim/lua/plugins/stata.lua

return {
  {
    "neovim/nvim-lspconfig",
    event = "BufReadPre *.do,*.ado,*.mata,*.doh",
    config = function()
      -- Register Stata filetype
      vim.filetype.add({
        extension = {
          ["do"] = "stata",
          ado = "stata",
          mata = "stata",
          doh = "stata",
        },
      })
      local lspconfig = require("lspconfig")
      local configs = require("lspconfig.configs")

      -- Register the Sight language server
      if not configs.sight then
        configs.sight = {
          default_config = {
            cmd = { "sight-language-server", "--stdio" },
            filetypes = { "stata" },
            root_dir = function(fname)
              return lspconfig.util.root_pattern(".sight.json", ".git")(fname)
                or lspconfig.util.path.dirname(fname)
            end,
            settings = {},
          },
        }
      end

      -- Setup the server
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
    end,
  },
}
