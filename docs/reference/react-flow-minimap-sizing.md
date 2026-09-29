# MiniMap dimensions belong to its prop

Read this before moving MiniMap dimensions between its `style` prop and CSS.

React Flow computes the MiniMap viewport from `style?.width ?? 200` and the matching height value.
CSS can resize what is painted without changing those JavaScript inputs, leaving the scale and viewBox
based on different dimensions from the visible box. Do not simplify the component by moving width and
height to a stylesheet: keep both values on the MiniMap `style` prop so rendering and viewport math use
the same size.
