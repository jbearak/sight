* Code after an if header's { is ignored; after any other { it is an
* error (r(198)).
if 1 { di "ignored"
    di "runs"
}
quietly { di "error"
    di "body"
}

* A program whose only syntax is in a brace block has that signature.
program define quiet_syntax
    quietly {
        syntax varlist [, Level(integer 95)]
    }
end
