* Demonstration of missing quote syntax error

clear all
set obs 1

* Missing closing quote - detected immediately
gen greeting = "Hello, world!