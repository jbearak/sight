// Every Sight directive kind, and placements Sight ignores.
// sight: done-by: "main.do"
* @lsp-run-by main
// sight: included-by "code/clean.do"
// @lsp-cd "code"
// sight: working-directory: .
version 17
// sight: done-by "late.do"
// sight: standalone
// sight: local a b
// @lsp-global G
* sight: scalar s
// sight: matrix: M
// @lsp-program myprog
// sight: variables v1 v2
// @lsp-var w
display `a' `b' $G // sight: local c
// sight: do "code/clean.do"
// @lsp-include: code/helpers.doh
* sight: run report
// sight: ignore
display `undef1'
// sight: ignore-next
display `undef2' ///
    `undef3'
display `undef4' // sight: ignore
display "x" // sight: ignore-next
display `undef5'
display "y" // sight: do "extra.do"
/* sight: local blocked */
/*
// sight: local blocked2
*/
// sight: ignore
// sight: do "report.do"
foreach v in a b {
    display "`v'"
    // @lsp-ignore
}
display `undef6'
// sight: local
// sight: ignore
