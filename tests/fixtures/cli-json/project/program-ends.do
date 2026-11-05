* Stata 18 checks: args and unab keep a stray operator with the name
* (r(198) when run); a mata block's end inside an if in a program ends
* the program; a program header can continue with ///; and under
* #delimit ; the { of an if can be on the next line.
program define stray
    args a/note
    unab x : a/b
end
program define cut
    if 1 {
        mata:
        x = 1
        end
    di "after"
}
program ///
    define cont, rclass
    return local x "hi"
end
#delimit ;
if 1
{;
    di "in";
};
#delimit cr
