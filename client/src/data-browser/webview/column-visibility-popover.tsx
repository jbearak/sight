import {
    useEffect,
    useRef,
    useState,
    type ReactElement,
} from 'react';
import type { VariableDescription } from '../types.js';
import { use_dismiss } from './use-dismiss.js';

export interface ColumnVisibilityPopoverProps {
    variables: VariableDescription[];
    hidden_columns: ReadonlySet<string>;
    on_toggle: (name: string) => void;
    on_show_all: () => void;
    on_hide_all: () => void;
    on_close: () => void;
}

export function ColumnVisibilityPopover({
    variables,
    hidden_columns,
    on_toggle,
    on_show_all,
    on_hide_all,
    on_close,
}: ColumnVisibilityPopoverProps): ReactElement {
    const [filter_text, set_filter_text] = useState('');
    const popover_ref = useRef<HTMLDivElement>(null);
    const filter_ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        filter_ref.current?.focus();
    }, []);

    use_dismiss(popover_ref, on_close);

    const my_filter_lower = filter_text.toLowerCase();
    const the_filtered_variables = filter_text === ''
        ? variables
        : variables.filter(my_v =>
            my_v.name.toLowerCase().includes(
                my_filter_lower
            )
            || my_v.label.toLowerCase().includes(
                my_filter_lower
            )
        );

    return (
        <div
            ref={popover_ref}
            className="columns-popover"
        >
            <input
                ref={filter_ref}
                type="text"
                className="columns-popover-filter"
                placeholder="Search columns..."
                value={filter_text}
                onChange={e =>
                    set_filter_text(e.target.value)
                }
            />
            <div className="columns-popover-actions">
                <button
                    className="popover-action-btn"
                    onClick={on_show_all}
                    type="button"
                >
                    Show all
                </button>
                <button
                    className="popover-action-btn"
                    onClick={on_hide_all}
                    type="button"
                >
                    Hide all
                </button>
            </div>
            <div className="columns-popover-list">
                {the_filtered_variables.map(my_v => (
                    <div
                        key={my_v.name}
                        className="columns-popover-item"
                        onClick={() =>
                            on_toggle(my_v.name)
                        }
                    >
                        <input
                            type="checkbox"
                            checked={
                                !hidden_columns.has(
                                    my_v.name
                                )
                            }
                            onChange={e =>
                                e.stopPropagation()
                            }
                        />
                        <label>
                            {my_v.name}
                            {my_v.label && (
                                <span className="columns-popover-label">
                                    {' '}{my_v.label}
                                </span>
                            )}
                        </label>
                    </div>
                ))}
                {the_filtered_variables.length === 0 && (
                    <div className="columns-popover-empty">
                        No matching columns
                    </div>
                )}
            </div>
        </div>
    );
}
