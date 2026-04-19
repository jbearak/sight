* Demonstration of else-on-same-line syntax error

clear all
scalar x = 1
scalar y = 2

* else on same line as closing brace - syntax error
if x == y {
    display "x equals y"
} else {
    display "x differs from y"
}
