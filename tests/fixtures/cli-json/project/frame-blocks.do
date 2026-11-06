* Each runs in Stata 18: a block runs its body in the frame.
frame create F x
local f F
global g F

frame F {
    replace x = 1
}
capture noisily frame F {
    replace x = 2
}
quietly frame F {
    replace x = 3
}
noisily quietly capture frame F {
    replace x = 4
}

* A macro can name the frame, with or without prefixes.
capture noisily frame `f' {
    replace x = 5
}
quietly capture frame $g {
    replace x = 6
}

* On one line, frame is a prefix of the command, not a block.
frame F: replace x = 7
capture noisily frame `f': replace x = 8

* A frame block nested in a loop.
foreach v in 9 10 {
    frame F {
        replace x = `v'
    }
}
display "after"
