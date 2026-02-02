* Demonstration of real-time error detection
* @lsp-working-directory: "/"

clear all

* Missing closing quote - detected immediately
local path "data/surveys

* Undefined macro reference - warning before you run
display "Result: `undefined_macro'"

* Macro used before definition - forward reference warning
local result = `total_count' + 10
local total_count = 100

* Unmatched braces - detected as syntax error
if mpg > 20 {
    display "High MPG"

    * else on same line as closing brace - syntax error
    if condition {
        do something
    } else {
        do other
    }
