* Stata 18 reads // and /// as a comment or a continuation only at the
* start of a line or after a space or tab. Anything else makes them text.
local a b///
display "a separate command"
local b b///note
local c b ///
    c
use http://www.stata-press.com/data/r18/auto, clear
#delimit ;
local d b///
c;
#delimit cr
