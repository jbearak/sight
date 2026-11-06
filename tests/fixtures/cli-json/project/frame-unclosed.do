* A frame block with no } before the program's end: as in Stata 18,
* that end still ends the program.
program define unclosed_frame
    capture noisily frame `0' {
        replace x = 1
end

* A frame block with no closing } runs to the end of the file.
capture noisily frame F {
    replace x = 2
display "still in the block"
