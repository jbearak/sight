summarize price [w=population]
foreach v of var mpg price {
    summarize `v'
}
if 0 display 1
else /* note */ if 1 display 2
display runiform()
program define example
    syntax [, Level(integer 95)]
end
