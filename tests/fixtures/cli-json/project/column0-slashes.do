* Under #delimit cr, a /// line that starts a statement is a comment at
* any indentation: Stata 18 joins the next line to it, which then runs
* as its own statement.
if 1 {
    ///
    display "after a slash line"
}
* Under #delimit semicolon, a // or /// at column 0 is a comment only on
* a statement's first line. A comment doesn't end the statement, so a
* later // or /// at column 0 is code.
#delimit ;
// first line of the statement: a comment
    // indented: a comment
display "ran";
local a b
/// x
c;
local e b
    /// y
f;
// a comment
// code: Stata reports "/ is not a valid command name"
display "not run";
#delimit cr
