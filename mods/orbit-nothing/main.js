// Draws nothing. Each pane's middle is a row of this, the pane's content and
// this again, zero wide: the row's divider draws the outline's two sides.

import { View, div } from "gpui-kit";

export default class OrbitNothing extends View {
  render() {
    return div();
  }
}
