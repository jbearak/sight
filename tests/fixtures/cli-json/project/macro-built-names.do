* Names joined to macro references (StataMP 18: local foo`x' 1 defines
* foo3 when x is 3). Each name is known only at run time.
local x 3
local foo`x' 1
global gg`x' 2
local ww`x' : word 2 of a b c
local ee`x' = 1 + 2
local ++foo`x'
local foo`x'bar 4
local foo${g} 5
local q`x'"a b"
* An extended function named by macros
global SR_`x'_s : `ch'(scalars)
local hn : `what'names m
* A name that starts with a macro stays a command, as before
local `x' 9
local `x'`x' 9
program pa
    args a`x' b `x'
end
gen v`x' = 1
#delimit ;
local dd`x' 4 ;
#delimit cr
