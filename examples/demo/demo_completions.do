* Demonstration of intelligent autocomplete

sysuse citytemp, clear
capture confirm variable tempjan
capture confirm variable tempjuly

* Command completion - type "sum" and see suggestions
* [Type "sum" and pause to show dropdown]


* Variable completion - LSP knows what's in your dataset
* [Type "gen new = t" and show tempjan, tempjuly appear]

* Macro completion - type backtick and local name
local fruit "apple banana cherry"
local color "red blue green"

* [Type "display `f" or "`c"]

* Option completion for commands
* [Type "summarize, " and show options like "detail"]
summarize

* option completion is imperfect 
* it does not yet have all possibilities in its current database
* however, it scans user-written programs, in addition to built-ins

* Global macro completion
global sample "if region == 1"
global controls "i.division"


* [Type "$sa" and see sample, then "$co" and see controls]
