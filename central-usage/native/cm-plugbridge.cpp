// cm-plugbridge - hosts one community plugin, walled off (plughost/bridge.h, plughost/bridge_main.cpp). Started by the
// rig (cu-rig) and the Central Pedal's community stage (cm-pwnode) inside bubblewrap / sandbox-exec - never by hand.
#include "plughost/bridge.h"
int main(int argc, char **argv) { return cmb_child_main(argc, argv); }
