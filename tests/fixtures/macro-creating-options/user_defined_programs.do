// Test file for user-defined programs with macro-creating options
// Demonstrates the pattern: syntax with local()/global() option + c_local/global `param'

// User-defined program that creates a local macro via local() option
program define mylevels
    syntax varname, local(name)
    levelsof `varlist', local(`local')
    c_local `local' ``local''
end

// User-defined program that creates a global macro via global() option
program define myglevels
    syntax varname, global(name)
    levelsof `varlist', local(temp)
    global `global' `temp'
end

// Usage examples
sysuse auto, clear

mylevels foreign, local(my_foreign)
display "My foreign levels: `my_foreign'"

myglevels rep78, global(my_rep)
display "My rep78 levels: $my_rep"
