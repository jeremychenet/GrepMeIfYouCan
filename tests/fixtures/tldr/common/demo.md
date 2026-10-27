# demo

> Demo page used by the tldr import tests.
> More information: <https://example.com>.

- List [a]ll files in a directory:

`demo {{[-a|--all]}} {{path/to/directory}}`

- Run a container from a tagged image:

`demo {{[run|container run]}} {{image:tag}}`

- Remove a directory and its contents, recursively (use `--dry-run` to simulate):

`rm {{[-rf|--recursive --force]}} {{path/to/directory}}`

- Print the ID column with a Go template:

`demo ls --format "\{\{.ID\}\}"`

- Send JSON data:

`demo send '{{{"name":"bob"}}}'`

- Print a non-ASCII value:

`demo echo 'café'`

- Do something with a very long title that goes on and on, well past the eighty character limit of the schema:

`demo long`

- List [a]ll files in a directory:

`demo {{[-l|--long]}}`
