* Expressions in assert and display
assert x > 5 & !missing(x)
assert `cond' | (y == 1 & z < .), rc0
capture assert inlist(region, 1, 2) if year >= 2000
display "n = " _N " mean " %5.2f r(mean)
di as result %9.0gc _N _col(20) as text "done" _n(2)
di in smcl "{bf:x}", "y",, "z" _c
di = 2 + 2 _dup(3) "-" _char(65) _request(answer)
assert (x > 5
di (1 + 2
