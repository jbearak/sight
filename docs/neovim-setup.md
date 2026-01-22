# Neovim Setup for Sight

This guide explains how to configure Neovim to use the Sight language server and tree-sitter grammar for Stata syntax highlighting.

## Prerequisites

- Neovim 0.8+ (for native LSP support)
- [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) plugin
- [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter) plugin
- Sight language server installed (see [Installation](#installing-the-language-server))

## Installing the Language Server

Install the Sight language server globally:

```bash
# Using bun
bun install -g github:jbearak/sight

# Using npm
npm install -g github:jbearak/sight
```

Verify the installation:

```bash
sight-language-server --help
```

## LazyVim / lazy.nvim Configuration

If you use [LazyVim](https://www.lazyvim.org/) or [lazy.nvim](https://github.com/folke/lazy.nvim), create a plugin file at `~/.config/nvim/lua/plugins/stata.lua`:

```lua
-- Sight LSP and tree-sitter configuration for Stata

return {
  {
    "neovim/nvim-lspconfig",
    event = "BufReadPre *.do,*.ado,*.mata,*.doh",
    config = function()
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
```

Then add filetype detection and tree-sitter parser config to `~/.config/nvim/lua/config/autocmds.lua`:

```lua
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
```

After adding this configuration, restart Neovim and run `:TSInstall stata` to install the tree-sitter parser.

## Standard Neovim Configuration (without lazy.nvim)

Add the following to your Neovim configuration (e.g., `~/.config/nvim/init.lua` or a separate file in `~/.config/nvim/lua/`):

```lua
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
      cmd = { 'sight-language-server', '--stdio' },
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
  -- Optional: customize settings
  settings = {
    sight = {
      diagnostics = {
        enabled = true,
        indentation = false,
      },
    },
  },
})
```

## Tree-sitter Configuration

For syntax highlighting, install and configure tree-sitter-stata:

### 1. Add the parser to nvim-treesitter

Add this to your configuration:

```lua
local parser_config = require('nvim-treesitter.parsers').get_parser_configs()

parser_config.stata = {
  install_info = {
    url = 'https://github.com/jbearak/tree-sitter-stata',
    files = { 'src/parser.c', 'src/scanner.c' },
    branch = 'main',
  },
  filetype = 'stata',
}
```

### 2. Install the parser

Run in Neovim:

```vim
:TSInstall stata
```

### 3. Enable highlighting

Ensure tree-sitter highlighting is enabled in your config:

```lua
require('nvim-treesitter.configs').setup({
  highlight = {
    enable = true,
  },
})
```

## Complete Example Configuration (Standard Neovim)

Here's a complete example combining both LSP and tree-sitter setup for standard Neovim (without lazy.nvim):

```lua
-- Stata filetype detection
vim.filetype.add({
  extension = {
    ["do"] = 'stata',
    ado = 'stata',
    mata = 'stata',
    doh = 'stata',
  },
})

-- Tree-sitter parser configuration
local parser_config = require('nvim-treesitter.parsers').get_parser_configs()
parser_config.stata = {
  install_info = {
    url = 'https://github.com/jbearak/tree-sitter-stata',
    files = { 'src/parser.c', 'src/scanner.c' },
    branch = 'main',
  },
  filetype = 'stata',
}

-- Tree-sitter setup
require('nvim-treesitter.configs').setup({
  highlight = {
    enable = true,
  },
})

-- LSP configuration
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.sight then
  configs.sight = {
    default_config = {
      cmd = { 'sight-language-server', '--stdio' },
      filetypes = { 'stata' },
      root_dir = function(fname)
        return lspconfig.util.root_pattern('.sight.json', '.git')(fname)
          or lspconfig.util.path.dirname(fname)
      end,
      settings = {},
    },
  }
end

lspconfig.sight.setup({})
```

## Verifying the Setup

1. Open a `.do` file in Neovim
2. Check LSP status with `:LspInfo` - you should see `sight` attached
3. Verify syntax highlighting is working (keywords should be colored)
4. Test features like go-to-definition (`gd`), hover (`K`), and completions

## Troubleshooting

### LSP not starting

- Ensure `sight-language-server` is in your PATH: `which sight-language-server`
- Check `:LspLog` for error messages
- Verify the filetype is detected: `:set filetype?` should show `stata`

### No syntax highlighting

- Run `:TSInstallInfo` and check if `stata` is installed
- Try reinstalling: `:TSInstall! stata`
- Check `:TSModuleInfo` to verify highlight module is enabled

### Parser compilation errors

If the tree-sitter parser fails to compile, ensure you have a C compiler installed:
- macOS: `xcode-select --install`
- Linux: `sudo apt install build-essential` (Debian/Ubuntu)
