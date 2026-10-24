/**
 * The board URL's own route under the board's layout (THE-118 PR 7): nothing of its own. The layout renders the board,
 * its idle panel, meta and headers; the trip URL is the layout's other child, shown as the board's panel on desktop.
 * A component (rendering nothing) all the same: a leaf route without one would be a resource route.
 */
export default function Board() {
  return null
}
