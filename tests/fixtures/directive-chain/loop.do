// @lsp-working-directory: "."
* loop.do - Sets working directory for the directive chain
* Working directory resolves to the fixture root (directive-chain/)

global loop_initialized = 1

run programs.do

do "subdir/survey.do"
