* Table generation called from orchestrator

* Use configuration from parent
save "$output_path/results.dta", replace

* Call shared program
calculate_weights

* Create macro for local use
local table_opts "cells(mean sd) format(%9.2f)"
