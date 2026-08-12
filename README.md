# Tilde Graph Architect

A pure HTML/CSS/JavaScript static web app for generating abstract layered bipartite graphs as SVG.

## Overview

Tilde Graph Architect visualizes complete bipartite graphs with multiple layers. It renders nodes as squares, edges as lines, and marks line–line intersections with additional squares scaled by intersection density. Everything runs client-side with no build step or framework required.

### Features

- **Dynamic node layout**: Configure columns and nodes per column via simple comma-separated input
- **Complete bipartite connections**: All nodes in one column connect to all nodes in the next
- **Intersection visualization**: Automatically detects and marks where edges cross
- **Customizable colors**: Line, node, and intersection colors independently configurable
- **SVG export**: Download the generated graph as a transparent SVG file
- **Real-time preview**: See changes instantly as you adjust parameters

## Getting Started

### Running Locally

1. **Simple method**: Open `index.html` directly in your browser:
   ```bash
   open index.html
   ```

2. **Via static server** (recommended for better compatibility):
   ```bash
   # Using Python 3
   python3 -m http.server 8000
   # Then open http://localhost:8000
   ```

   ```bash
   # Using Node.js (with http-server)
   npx http-server
   ```

3. **Using VS Code Live Server**:
   - Install the "Live Server" extension
   - Right-click `index.html` and select "Open with Live Server"

## Controls Reference

### Graph Configuration

**Nodes per column** (text input)
- Format: comma-separated integers, e.g., `1,5,6`
- Each number specifies how many nodes appear in that column
- Clamped to: 2–6 columns, 1–8 nodes per column
- Default: `1,5,6`
- Invalid entries are skipped; if fewer than 2 valid entries, defaults are used

**Column spacing** (number input)
- Controls how far apart columns are spread horizontally
- Range: 0 to 1.5 (where 1.0 = normal/default spacing across full width)
- Default: 1.0
- 0.5 = columns compressed to half the available width
- 1.5 = columns spread wider than normal (extends beyond margins)
- 0.0 = all columns stacked at the left margin
- Useful for creating compact or spread-out layouts

**Row spacing** (number input)
- Controls how far apart nodes are spread vertically
- Range: 0 to 1.5 (where 1.0 = normal/default spacing across full height)
- Default: 1.0
- 0.5 = nodes compressed to half the available height (taller graph)
- 1.5 = nodes spread wider vertically (extends beyond margins)
- 0.0 = all nodes stacked at the top margin
- Useful for making graphs taller or shorter

### Line Rendering

**Line thickness** (number input)
- Controls the SVG stroke-width of edges
- Range: 0.1 to 10
- Default: 0.5
- Smaller values = thinner, more delicate lines

**Line color** (color picker)
- RGB color of the edge lines
- Default: `#939393` (medium gray)

### Node Sizing

**Node base size** (number input)
- Minimum size of node squares (in SVG units)
- Range: 0.5 to 20
- Default: 2

**Node scale k** (number input)
- Multiplier applied per unit of node degree
- Size formula: `baseSize + k × degree`
- Higher values = larger nodes for high-degree nodes
- Range: 0 to 5
- Default: 0.4

**Node color** (color picker)
- RGB color of node endpoint squares and intersections
- Default: `#939393` (medium gray)

**Show edge nodes** (checkbox)
- When **checked** (default): draws node squares at all endpoints
- When **unchecked**: hides squares for the leftmost and rightmost columns
  - Degree calculations remain unchanged; only visibility is affected
  - Useful for cleaner aesthetics when edge columns have many nodes

### Intersection Visualization

Intersections are automatically sized based on the node sizing controls for visual consistency:
- **Intersection base size** = `nodeBaseSize + nodeScaleK` (smallest intersection = smallest node + 1× node scale)
- **Intersection scale** = same as `nodeScaleK` (scales with intersection count)
- Intersections use the same color as nodes

**Intersection merge tolerance** (number input)
- Nearby intersections are merged into one square
- Measured in SVG units (roughly pixels)
- Prevents visual clutter when many edges cross very close together
- Range: 0.1 to 10
- Default: 1
- Larger values = more aggressive merging

### Background

**Background color** (color picker)
- Sets the CSS background of the preview container
- Applied only to the on-screen preview, **not** to the exported SVG
- Exported SVG is always transparent
- Default: `#000000` (black)

### Actions

**Regenerate button**
- Reads all control values
- Rebuilds the graph from scratch
- Recomputes intersections with current merge tolerance
- Updates the preview

**Download SVG button**
- Saves the current graph as `tilde-graph.svg`
- File is transparent (no background rectangle)
- Ready to import into design tools, editors, or further processing

## Customization

### SVG Canvas Size

To change the default SVG dimensions, edit the `config` object in `graph.js`:

```javascript
const config = {
    svgWidth: 1400,      // default width in units
    svgHeight: 1400,     // default height in units
    marginLeft: 100,     // left margin
    marginRight: 100,    // right margin
    marginTop: 100,      // top margin
    marginBottom: 100,   // bottom margin
    // ... other defaults
};
```

### Default Control Values

All UI input defaults are set in `index.html`:

```html
<input type="text" id="nodesInput" value="3,5,6">
<input type="number" id="lineThickness" value="0.5">
<input type="number" id="nodeBaseSize" value="2">
<!-- etc. -->
```

Change the `value` attributes to customize initial state.

## Architecture

### Files

- **index.html**: UI layout, form controls, preview container
- **styles.css**: Dark theme styling, responsive layout, control panel and preview areas
- **graph.js**: Core graph generation, intersection detection, SVG rendering
- **README.md**: This file

### Graph Generation Pipeline (graph.js)

1. **readControlsToConfig()** – reads DOM inputs and parses node configuration
2. **generateNodes()** – positions nodes in columns with even spacing
3. **generateEdges()** – creates complete bipartite connections and updates node degrees
4. **computeIntersections()** – detects all line–line intersections using 2D geometry
5. **buildSvg()** – renders nodes, edges, and intersections as SVG elements
6. **render()** – orchestrates the pipeline and updates the preview

### Complexity Notes

- Line–line intersection computation is O(E²) where E = number of edges
- For typical graphs (e.g., 6 columns × 8 nodes each), this is very fast
- Intersection merging prevents visual clutter without affecting graph logic

## Notes on Exported SVG

- The exported SVG contains **only** lines and squares; no background, no CSS
- It is fully transparent and compatible with standard SVG tools
- Stroke color, line width, and all size parameters are baked into the SVG markup
- The viewBox is set to match the canvas dimensions for crisp scaling

## Example Graph Configurations

| Input | Columns | Edges | Description |
|-------|---------|-------|-------------|
| `2,2` | 2 | 4 | Simple bipartite |
| `3,3,3` | 3 | 18 | Cubic three-layer |
| `1,5,6` | 3 | 35 | Triangle-like density |
| `2,4,6,4,2` | 5 | 136 | Symmetric diamond |

## License

Open source. Use freely.

