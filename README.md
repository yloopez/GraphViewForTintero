# Graph View Tintero plugin

An Obsidian-style map of a writing project. Characters, worldbuilding, manuscript
files, scenes, notes, tags, timelines, flow maps and grids become nodes; every
relation Tintero already records between them becomes a link. Drag it around,
search it, filter it, click anything to see what it touches.

*An unofficial plugin, not affiliated with Tintero.*

## Read-only

Graph View only ever reads your project; it cannot change it. Every permission
it asks Tintero for is a read permission, plus two small ones for showing a
notification and keeping its own settings. There is no permission to write,
import, export, or reach the network, and Tintero checks every call, so a write
would be refused before it touched your work. The one thing the plugin saves is
its own display preferences (hidden types, colours, sliders), in its own
storage, which Tintero deletes along with the plugin. `make check` fails the
build if a permission that could write is ever added.

## Install

```sh
make            # validate, test, and build dist/plugin.zip
```

Then, in Tintero: **Settings → Plugins → Load local plugin (dev)** and pick
`dist/plugin.zip`. Graph View appears in the sidebar menu; opening it fills the
main view.

`make` needs `node`, plus either `zip` or PowerShell to build the archive. If you
do not have `make`, the four files in `src/` zipped flat is the whole product:

```sh
node tools/validate.js && node tools/harness.js
mkdir -p dist && cd src && zip -FSr ../dist/plugin.zip .
```

| Target | |
|---|---|
| `make` | validate, test, build `dist/plugin.zip` |
| `make check` | validate the manifest and sources |
| `make test` | run the plugin against a fake host, on a small and an empty project |
| `make test-big` | time the layout on a ~1000-node project |
| `make verify` | list what ended up inside the zip |
| `make clean` | remove `dist/` |

## What becomes a link

| From | To | Where it comes from |
|------|-----|---------------------|
| Character | Character | `relationships`, with the relation type as the label |
| Character | Worldbuilding | all 48 `character.worldbuilding` fields, faction led, location ruled, items owned, events attended, deities followed, and the rest, plus `birthplace` |
| Character | Attached document | the document's virtual path |
| Character | Manuscript file | scene POV, `charactersInScene` |
| Location / item | Manuscript file | scene `locationId`, `objectsInScene` |
| File / document | File / document | links made with Tintero's own link tool (the item's `links` list) |
| File / document | Anything | a `customMetadata` value naming an entity, labelled with the metadata key |
| File / document | Folder | `treePath` containment |
| Worldbuilding | Anything | an `extraFields` value naming an entity, labelled with the field key |
| Anything | Tag | `tags` on characters and worldbuilding, `keywords` on files and documents |
| Note | File | `note.fileId`, or `note.location` |
| Collection | Its items | `collection.items` |
| Timeline | Files, characters, worldbuilding | lane blocks, plus sub-timeline nesting. A block pairing a character or element with a file also links the two directly |
| Flow map | Linked entities | `linkedDocument`, `linkedCharacterId`, `linkedWorldbuildingId` and two flow nodes connected to each other link the entities behind them |
| Plot grid / cardboard | Referenced entities | cell `referenceId` |

References resolve by id first, then by name, then by the last segment of a
path. A reference may also arrive as an object rather than a string, in which
case its `id`, `name` or similar field is unwrapped.

The graph shows what Tintero records about your project, never what you have
written in it: the plugin has no permission to read document text. Typing
`[[Chapter Two]]` into a chapter therefore does **not** create a link. Use
Tintero's link tool, or one of the fields in the table above.

### Attached documents

A document attached to a character carries no owner field on either object.
Tintero encodes the relation in the document's path instead:

```
*characters*/5d796b85-2187-413d-8f29-1acc042a4123/new file
 └ virtual root  └ the owner's id                  └ document name
```

Any path segment naming a known entity becomes an "attached to" link. Segments
matching an **id** always link; segments matching a **name** link only directly
beneath an `*asterisk*` root, where a segment cannot be an ordinary folder,
otherwise a real folder sharing a character's name would invent a false edge.

The rule is generic, not hardcoded to `*characters*`, so other virtual roots
(`*worldbuilding*`, for instance) work the same way.

## Using it

| Mouse | Touch | |
|---|---|---|
| Drag background | Drag background | pan |
| Scroll | Pinch | zoom, about the pointer or between the fingers |
| Drag a node | Drag a node | pull it around; it springs back on release |
| Shift-drag or Shift-click a node, or **Pin** in the details panel | **Pin** in the details panel | pin it, or unpin it if it was pinned. Pinned nodes carry a thin ring |
| Click | Tap | select, and show its connections |
| Double-click | Double-tap | centre on a node, or fit the whole graph |

The keyboard shortcuts:

| | |
|---|---|
| `Ctrl`/`Cmd`+`F` | jump to the search box |
| `↑` `↓` | move through the search results |
| `Enter` | jump to the highlighted result |
| `R` | refresh now |
| `Esc` | clear the search, or the selection |

The toolbar holds **Panel** (show or hide the left panel, which also has its own
hide arrow in its top corner), the search box,
**Fit**, **Live** and **Refresh**.

| Display option | |
|---|---|
| **Unconnected nodes** | off by default, a graph reads better without leaves. Turn it on when starting a project, so things appear before you have linked them |
| **Size by length** | off by default, meaning node size shows how *connected* something is. Turn it on and size shows how much has been *written* about it instead, word count for manuscript files and documents, and for everything else the length of its own description, backstory and notes. A character you have developed heavily is large; a location you named once and never fleshed out is small, however many scenes it appears in |
| **Repel / Link distance** | how tightly the layout packs |
| **Label fade** | the zoom level at which labels appear |

Folders are hidden by default for the same reason as unconnected nodes: they are
structure, not story, and they crowd the view. Switch **Folders** on to see them.

Nodes are coloured by **type**, and the swatches down the left panel are the key.
Tintero's own per-item colours are deliberately ignored: it gives every character
the same default colour (`#c98a48`, the theme accent), so honouring them paints
most of the graph one shade and destroys the type coding. Custom worldbuilding
types keep the colour set on their template, or a stable colour derived from the
type name if the template has none.

**Click any swatch to recolour that type.** It is a live colour picker, so the
graph, the legend and the details panel all follow as you drag. Choices are kept
in plugin storage between sessions, and a **reset colours** button appears beside
**all** once you have changed something. Setting a type back to its original
colour drops the override rather than storing it. Because every custom
worldbuilding type shares one "Other worldbuilding" row, recolouring that row
paints all of them the same; leave it alone and they keep their template colours.

## Staying current

Auto-refresh (the **Live** button) is on by default. The plugin listens for
`project.loaded`, `project.changed`, `project.saved`, `file.saved`,
`file.closed`, and the character and worldbuilding add/update/delete events, as
well as the SDK's `onProjectChange` hook, then rebuilds after a 1.4-second
debounce. Node positions carry over so the picture does not jump, and the status
bar reports what changed, `+2 nodes · +5 links`. A change that lands while a
refresh is already reading the project is not lost: one more refresh runs as
soon as the current one finishes. Turn Live off to freeze the graph;
**Refresh** and `R` still work.

## Tests

`node tools/harness.js` runs the real, unmodified `plugin.js` against a fake DOM
and a fake host, then asserts on the result:

- exact node and link counts for the synthetic project
- the live-refresh diff reports the new link
- the scene cache holds, so a refresh makes no extra `getScenes()` calls
- both sizing modes vary node size, differ from each other, and persist
- search lists a match, `Enter` selects it, filter-hidden matches are counted,
  and a miss says so
- a type colour override reaches the nodes, persists, and resets
- touch: a pinch zooms, the finger left after a pinch does not pan, a tap on
  empty space clears the selection and a tap on a node opens it, **Pin** holds a
  node still while the layout moves, and a double-tap centres on a node even
  when the browser follows it with a `dblclick` of its own
- battery: once the layout settles no frame is scheduled, two scrolls in one
  frame share a single redraw, and every change that does not move the layout
  (search, recolouring, the label slider, hovering, closing the details) still
  asks for a frame, so the screen never goes stale
- the left panel: its own arrow hides it and **Panel** brings it back, both
  saved on a wide window; it closes itself at 1100px or less, a choice made
  there holds but is not saved, and resizing across 1100px applies the
  automatic rule again
- a refresh asked for while another is running runs once it finishes, so a
  change made mid-read still reaches the graph; and a preference changed while
  an earlier save is being written is saved afterwards, not skipped
- with Live off, a project change triggers no reload and the status dot goes dark
- no event handlers survive `onDeactivate`, and no unexpected notifications

`EMPTY=1` checks the empty-project path; `BIG=1` builds ~1000 nodes and prints
the layout timing (it is reported, not asserted).

Because frames are drawn on demand, a test that needs a picture of an idle
graph calls `redraw()`, which fires the window's `resize` handlers the way a
real resize would, rather than `pump()`, which only runs frames already queued.

The synthetic project deliberately includes the awkward cases: a character-
attached document, a worldbuilding-attached document, and a decoy document in a
real folder named after a character that must **not** link. If you add a linking
rule, add its data there and update the expected counts — the assertions are
exact, so a silent regression fails the build.

The harness finds nodes on the canvas by recording where each filled circle is
drawn, then fires pointer events at those points. Layout (CSS) is not covered:
the fake DOM has no layout engine.

The harness's fake DOM takes shortcuts: `innerHTML` is not parsed (so button
labels have no text — find buttons by `title`), and its class lookup matches by
substring (`tgv-search` also matches `tgv-search-wrap`). When a new assertion
comes back empty, suspect the selector before the plugin.

## License

MIT, see [LICENSE](LICENSE).
