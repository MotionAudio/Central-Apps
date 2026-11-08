#!/usr/bin/python3
"""
Central Pedal main board, rev A - the whole board as data.

Every part: reference, footprint, value, LCSC part number (when known), and which net each pad is on.
Placement is here too (board coordinates in mm, origin top-left, y down; the board is 270 x 160).
build.py turns this into a KiCad board, routes it and exports the fab files.

Rails:  VBUS (USB-C in) -> IP2368 charger -> VBAT (2S pack) -> F1 -> PFET -> INA226 shunt -> TPS54560 -> 5V1 -> TLV75533 -> 3V3
"""
import math

W, H = 270.0, 160.0          # board size

# ---------------------------------------------------------------- footprints
FP = {
    "R0603": ("Resistor_SMD", "R_0603_1608Metric"),
    "R0805": ("Resistor_SMD", "R_0805_2012Metric"),
    "R1206": ("Resistor_SMD", "R_1206_3216Metric"),
    "R2512": ("Resistor_SMD", "R_2512_6332Metric"),
    "C0603": ("Capacitor_SMD", "C_0603_1608Metric"),
    "C0805": ("Capacitor_SMD", "C_0805_2012Metric"),
    "C1206": ("Capacitor_SMD", "C_1206_3216Metric"),
    "C1210": ("Capacitor_SMD", "C_1210_3225Metric"),
    "CPOL": ("Capacitor_SMD", "CP_Elec_6.3x5.8"),
    "L0805": ("Inductor_SMD", "L_0805_2012Metric"),          # ferrite beads
    "LPWR": ("Inductor_SMD", "L_Bourns_SRP7028A_7.3x6.6mm"),
    "LED0603": ("LED_SMD", "LED_0603_1608Metric"),
    "SOD123": ("Diode_SMD", "D_SOD-123"),
    "SOD523": ("Diode_SMD", "D_SOD-523"),
    "SMA": ("Diode_SMD", "D_SMA"),
    "FUSE1812": ("Fuse", "Fuse_1812_4532Metric"),
    "SOT23": ("Package_TO_SOT_SMD", "SOT-23"),
    "SOT23-5": ("Package_TO_SOT_SMD", "SOT-23-5"),
    "TSOT23-8": ("Package_TO_SOT_SMD", "TSOT-23-8"),
    "SOIC8": ("Package_SO", "SOIC-8_3.9x4.9mm_P1.27mm"),
    "SOIC16": ("Package_SO", "SOIC-16_3.9x9.9mm_P1.27mm"),
    "HSOP8": ("Package_SO", "HSOP-8-1EP_3.9x4.9mm_P1.27mm_EP2.41x3.1mm_ThermalVias"),
    "TSSOP14": ("Package_SO", "TSSOP-14_4.4x5mm_P0.65mm"),
    "TSSOP20": ("Package_SO", "TSSOP-20_4.4x6.5mm_P0.65mm"),
    "TSSOP28": ("Package_SO", "TSSOP-28_4.4x9.7mm_P0.65mm"),
    "SSOP28": ("Package_SO", "SSOP-28_5.3x10.2mm_P0.65mm"),
    "VSSOP10": ("Package_SO", "VSSOP-10_3x3mm_P0.5mm"),
    "TQFP32": ("Package_QFP", "TQFP-32_7x7mm_P0.8mm"),
    "QFN48": ("Package_DFN_QFN", "QFN-48-1EP_7x7mm_P0.5mm_EP5.15x5.15mm_ThermalVias"),
    "WQFN16": ("Package_DFN_QFN", "Texas_RTE_WQFN-16-1EP_3x3mm_P0.5mm_EP1.2x0.8mm_ThermalVias"),
    "XTAL3225": ("Crystal", "Crystal_SMD_3225-4Pin_3.2x2.5mm"),
    "OSC3225": ("Oscillator", "Oscillator_SMD_Abracon_ASE-4Pin_3.2x2.5mm"),
    "USBC": ("Connector_USB", "USB_C_Receptacle_HRO_TYPE-C-31-M-12"),
    "PI40": ("Connector_PinSocket_2.54mm", "PinSocket_2x20_P2.54mm_Vertical"),
    "XH2": ("Connector_JST", "JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical"),
    "XH4": ("Connector_JST", "JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical"),
    "PH2": ("Connector_JST", "JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical"),
    "PH4": ("Connector_JST", "JST_PH_B4B-PH-K_1x04_P2.00mm_Vertical"),
    "VH2": ("Connector_JST", "JST_VH_B2P-VH_1x02_P3.96mm_Vertical"),
    "JACK635": ("custom", "Jack_6.35mm_Neutrik_NMJ6HCD2_Horizontal"),
    "JACK35": ("Connector_Audio", "Jack_3.5mm_PJ320D_Horizontal"),
    "POT_PUSH": ("custom", "RV09_Push_Vertical"),
    "POT_DUAL": ("Potentiometer_THT", "Potentiometer_Alps_RK09L_Double_Vertical"),
    "FADER": ("Potentiometer_THT", "Potentiometer_Bourns_PTA4543_Single_Slide"),
    "SJ": ("Jumper", "SolderJumper-2_P1.3mm_Open_RoundedPad1.0x1.5mm"),
    "TP": ("TestPoint", "TestPoint_Pad_D1.5mm"),
    "HOLE_M3": ("MountingHole", "MountingHole_3.2mm_M3"),
    "HOLE_M25": ("MountingHole", "MountingHole_2.7mm"),
}

# JLCPCB basic / common parts (checked ones only; the rest JLC matches by the manufacturer part number)
LCSC = {
    ("R0603", "10k"): "C25804", ("R0603", "100k"): "C25741", ("R0603", "1k"): "C21190", ("R0603", "100R"): "C23138",
    ("R0603", "0R"): "C21189", ("R0603", "4.7k"): "C23162", ("R0603", "2.2k"): "C4190", ("R0603", "33R"): "C23140",
    ("R0603", "10R"): "C22859", ("R0603", "22R"): "C23345", ("R0603", "47k"): "C25819", ("R0603", "330R"): "C23138x",
    ("C0603", "100n"): "C14663", ("C0603", "1u"): "C15849", ("C0603", "10u"): "C19702", ("C0603", "22p"): "C1653",
    ("C0603", "2.2u"): "C23630", ("C0603", "100p"): "C14858", ("C0603", "1n"): "C1588", ("C0603", "2.2n"): "C1593",
    ("C0805", "22u"): "C45783", ("C0603", "4.7u"): "C19666",
    ("USBC", "USB-C"): "C165948", ("QFN48", "IP2368_BZ"): "C5203723", ("TQFP32", "PCM2706CPJTR"): "C2651268",
}
LCSC.pop(("R0603", "330R"))   # (not sure of that one)

PI_PIN = {  # BCM GPIO -> 40-pin header pin
    2: 3, 3: 5, 4: 7, 14: 8, 15: 10, 17: 11, 18: 12, 27: 13, 22: 15, 23: 16, 24: 18, 10: 19, 9: 21, 25: 22, 11: 23, 8: 24,
    7: 26, 0: 27, 1: 28, 5: 29, 6: 31, 12: 32, 13: 33, 19: 35, 16: 36, 26: 37, 20: 38, 21: 40,
}


class Design:
    def __init__(self):
        self.parts = []          # dicts
        self.counter = {}
        self.notes = []

    def add(self, ref, fp, value, pins, at, rot=0, side="F", lcsc=None, mpn=None, dnp=False, desc=""):
        if ref.endswith("?"):
            prefix = ref[:-1]
            self.counter[prefix] = self.counter.get(prefix, 0) + 1
            ref = "%s%d" % (prefix, self.counter[prefix])
        if lcsc is None:
            lcsc = LCSC.get((fp, value), "")
        self.parts.append(dict(ref=ref, fp=fp, value=value, pins=dict(pins), at=at, rot=rot, side=side, lcsc=lcsc, mpn=mpn or "", dnp=dnp, desc=desc))
        return ref

    # two-pin passives
    def R(self, value, a, b, at, rot=0, fp="R0603", **kw):
        return self.add("R?", fp, value, {"1": a, "2": b}, at, rot, **kw)

    def C(self, value, a, b, at, rot=0, fp="C0603", **kw):
        return self.add("C?", fp, value, {"1": a, "2": b}, at, rot, **kw)

    def L(self, value, a, b, at, rot=0, fp="L0805", **kw):
        return self.add("FB?", fp, value, {"1": a, "2": b}, at, rot, **kw)

    def D(self, value, anode, cathode, at, rot=0, fp="SOD123", **kw):   # KiCad diode footprints: pad 1 = cathode, pad 2 = anode
        return self.add("D?", fp, value, {"1": cathode, "2": anode}, at, rot, **kw)

    # a row of 0603 passives starting at (x, y), stepping dx
    def row(self, items, x, y, dx=3.2, rot=0):
        refs = []
        for i, it in enumerate(items):
            kind, value, a, b = it[:4]
            kw = it[4] if len(it) > 4 else {}
            fn = {"R": self.R, "C": self.C, "L": self.L}[kind]
            refs.append(fn(value, a, b, (x + i * dx, y), rot, **kw))
        return refs

    def nets(self):
        out = {}
        for p in self.parts:
            for pad, net in p["pins"].items():
                if net:
                    out.setdefault(net, []).append((p["ref"], pad))
        return out


def build():
    d = Design()
    n = d.notes.append

    # ================================================================ connectors
    # Rear edge (y = 0): all jacks, from the left.  NMJ6HCD2 rotated 270: plug enters from -y; body extends to -x of the origin.
    jacks = {   # ref: (x, tip net, ring net, sleeve net, TN, RN)
        "J25": (28, "HP_L", "HP_R", "GND", "", ""),               # headphones (TRS stereo)
        "J11": (50, "OUT6", "GND_R6", "GND", "", ""),             # out 6 (impedance balanced: ring = GND through 100R)
        "J10": (72, "OUT5", "GND_R5", "GND", "", ""),
        "J9": (94, "OUT4", "GND_R4", "GND", "", ""),
        "J8": (116, "OUT3", "GND_R3", "GND", "", ""),
        "J12": (138, "INST_IN", "INST_DET", "GND", "GND", ""),    # instrument: TN grounds the tip when nothing is plugged; ring = plug detect
        "J24": (160, "EXT_A", "EXT_B", "GND", "", ""),            # external dual footswitch
    }
    jack_desc = {"J25": "Headphones", "J11": "Output 6", "J10": "Output 5", "J9": "Output 4", "J8": "Output 3", "J12": "Instrument in", "J24": "Ext footswitch"}
    for ref, (x, t, r, s, tn, rn) in jacks.items():
        d.add(ref, "JACK635", "1/4in TRS", {"T": t, "R": r, "S": s, "TN": tn, "RN": rn, "SN": ""}, (x, 4.5), 270, mpn="Neutrik NMJ6HCD2", desc=jack_desc[ref])
    # MIDI (3.5 mm TRS, type A: tip = pin 4 current source, ring = pin 5 sink)
    d.add("J13", "JACK35", "MIDI IN", {"T": "MIDI_IN_T", "R1": "MIDI_IN_R", "R2": "", "S": ""}, (173, 7.5), 270, mpn="PJ-320D 3.5mm TRRS", desc="MIDI IN")
    d.add("J14", "JACK35", "MIDI OUT", {"T": "MIDI_OUT_T", "R1": "MIDI_OUT_R", "R2": "", "S": "GND"}, (187, 7.5), 270, mpn="PJ-320D 3.5mm TRRS", desc="MIDI OUT")
    # USB-C charge input (rotated 180: opening at -y)
    usb = {"A1": "GND", "B1": "GND", "A12": "GND", "B12": "GND", "A4": "VBUS", "B4": "VBUS", "A9": "VBUS", "B9": "VBUS",
           "A5": "CC1", "B5": "CC2", "A6": "USB_DP", "B6": "USB_DP", "A7": "USB_DM", "B7": "USB_DM", "A8": "", "B8": "", "S1": "GND"}
    d.add("J2", "USBC", "USB-C", usb, (206, 3.65), 180, mpn="HRO TYPE-C-31-M-12", desc="USB-C charge input")
    d.add("J5", "XH2", "POWER BTN", {"1": "PB", "2": "GND"}, (222, 6), 0, mpn="JST B2B-XH-A", desc="Front power button")

    # Bottom edge (y = 160): footswitches, fan, display power, battery
    for i in range(8):
        x = 30 + 24 * i
        d.add("J%d" % (15 + i), "XH4", "FOOTSW %d" % (i + 1), {"1": "FS%d" % (i + 1), "2": "GND", "3": "LED_A", "4": "LED%d" % (i + 1)}, (x, 155), 0, mpn="JST B4B-XH-A", desc="Footswitch %d + light" % (i + 1))
        # ESD + debounce right behind the connector (the switch line), 100R series to the Pi
        d.R("100R", "FS%d" % (i + 1), "GPIO_FS%d" % (i + 1), (x - 1, 148.5))
        d.C("100n", "FS%d" % (i + 1), "GND", (x + 2, 148.5))
        d.D("PESD5V0S1UB", "GND", "FS%d" % (i + 1), (x + 4.8, 148.5), 90, fp="SOD523", mpn="Nexperia PESD5V0S1UB")
    d.add("J23", "PH2", "FAN", {"1": "FAN_N", "2": "5V1"}, (226, 155), 0, mpn="JST B2B-PH-K-S", desc="5 V fan")
    d.add("J6", "PH2", "DISPLAY 5V", {"1": "GND", "2": "DISP_5V"}, (238, 155), 0, mpn="JST B2B-PH-K-S", desc="Touch Display 2 power")
    d.add("F2", "FUSE1812", "2A PTC", {"1": "5V1", "2": "DISP_5V"}, (238, 148), 0, mpn="Bourns MF-MSMF200-2", desc="Display PTC fuse")
    d.add("J3", "VH2", "BATTERY 2S", {"1": "GND", "2": "BAT_RAW"}, (252, 153), 0, mpn="JST B2P-VH", desc="2S battery pack (10 A rated)")
    d.add("J7", "PH4", "USB TO PI", {"1": "USB2_5V", "2": "USB2_DM", "3": "USB2_DP", "4": "GND"}, (120, 131), 0, mpn="JST B4B-PH-K-S", desc="Pigtail to a Pi USB-A port")

    # Raspberry Pi 40-pin header: on the BACK of the board (the Pi sits behind it), 2x20 rotated to run along x
    pi = {}
    pwr5 = {2: "5V1", 4: "5V1"}
    gnd = [6, 9, 14, 20, 25, 30, 34, 39]
    for p in range(1, 41):
        pi[str(p)] = ""
    for p, net in pwr5.items():
        pi[str(p)] = net
    for p in gnd:
        pi[str(p)] = "GND"
    pi["1"] = pi["17"] = "PI_3V3"
    gpio_net = {
        2: "SDA", 3: "SCL", 0: "ID_SD", 1: "ID_SC", 14: "MIDI_TX", 15: "MIDI_RX", 18: "I2S_BCK", 19: "I2S_LRCK", 20: "I2S_DIN", 21: "I2S_DOUT",
        10: "SPI_MOSI", 9: "SPI_MISO", 11: "SPI_SCLK", 8: "SPI_CE0", 5: "GPIO_FS1", 6: "GPIO_FS2", 12: "GPIO_FS3", 13: "GPIO_FS4", 16: "GPIO_FS5",
        17: "GPIO_FS6", 22: "GPIO_FS7", 23: "GPIO_FS8", 4: "PWR_INT", 24: "PWR_KILL", 25: "DAC_XSMT", 27: "STATUS_LED", 26: "FAN_CTL", 7: "INST_DET",
    }
    for g, net in gpio_net.items():
        pi[str(PI_PIN[g])] = net
    d.add("J1", "PI40", "RASPBERRY PI 4", pi, (135, 60), 90, side="B", mpn="2x20 female stacking header 2.54 mm", desc="Raspberry Pi 4 GPIO (Pi behind the board)")

    # ================================================================ power: charger (IP2368) - top right
    cx, cy = 222, 30
    ip = {str(k): "" for k in range(1, 50)}
    ip.update({"8": "VBUS", "9": "VBUSG", "10": "VBUS_I", "11": "GND", "12": "VIN_HB", "13": "VBUS_I", "14": "VIN_HB", "15": "PCIN",
               "16": "HG1", "17": "BST1", "18": "LX1", "19": "LG1", "20": "LG2", "21": "LX2", "22": "BST2", "23": "HG2", "24": "PCON",
               "25": "VBAT", "26": "HB_OUT", "27": "VBAT", "29": "VCC5V", "30": "GND", "32": "VCCIO", "33": "R_BATNUM", "34": "R_FCAP",
               "35": "R_VSET", "36": "R_ISET", "37": "R_NTC", "38": "CC2", "39": "USB_DP", "40": "USB_DM", "41": "CC1", "43": "CHG_LED1",
               "47": "GND", "49": "GND"})
    d.add("U1", "QFN48", "IP2368_BZ", ip, (cx, cy), 0, mpn="Injoinic IP2368_BZ", desc="2S charger, USB-C PD")
    # setting resistors (datasheet tables): 2S = 6.2k, 4.20 V/cell = 10k, 2 A = 10k (ISET_MODE grounded), NTC not used = 10k
    d.row([("R", "6.2k", "R_BATNUM", "GND"), ("R", "10k", "R_FCAP", "GND"), ("R", "10k", "R_VSET", "GND"), ("R", "10k", "R_ISET", "GND"), ("R", "10k", "R_NTC", "GND")], 214, 41.5)
    d.row([("C", "2.2u", "VCC5V", "GND"), ("C", "2.2u", "VCCIO", "GND"), ("C", "100n", "VIN_HB", "GND"), ("C", "1u", "VIN_HB", "GND")], 216, 18)
    d.R("10k", "CHG_LED1", "3V3", (229, 18))
    d.R("10R", "PCIN", "LX1", (212, 44.5), 0)
    d.R("10R", "PCON", "LX2", (215.2, 44.5), 0)
    n("IP2368 PCIN/PCON tied to LX1/LX2 through 10R (R26/R27 in the Injoinic BOM) - confirm against the Injoinic reference schematic.")
    n("IP2368 FCAP resistor set to 10k - the capacity table is not in the datasheet excerpt; it only affects the LED gauge.")
    # input path NMOS (Q1) and the H-bridge: SO-8 N-MOSFETs, pins 1-3 S, 4 G, 5-8 D
    def nmos(ref, g, dd, s, at, rot=0, mpn="AO4406A"):
        d.add(ref, "SOIC8", mpn, {"1": s, "2": s, "3": s, "4": g, "5": dd, "6": dd, "7": dd, "8": dd}, at, rot, mpn="Alpha&Omega " + mpn, desc="N-MOSFET 30 V")
    nmos("Q1", "VBUSG", "VBUS", "VBUS_I", (213, 13))
    nmos("Q2", "HG1", "VIN_HB", "LX1", (208, 26))
    nmos("Q3", "LG1", "LX1", "GND", (208, 36))
    nmos("Q4", "HG2", "HB_OUT", "LX2", (237.5, 26))
    nmos("Q5", "LG2", "LX2", "GND", (237.5, 36))
    d.add("L1", "LPWR", "10uH 6A", {"1": "LX1", "2": "LX2"}, (222, 47.5), 0, mpn="Bourns SRP7028A-100M", desc="Charger inductor")
    d.C("100n", "BST1", "LX1", (219.5, 37))
    d.C("100n", "BST2", "LX2", (225, 37))
    d.add("R_CS1", "R2512", "5mR", {"1": "VBUS_I", "2": "VIN_HB"}, (208, 19), 0, mpn="5 mOhm 1% 2512 sense", desc="Input current sense")
    d.add("R_CS2", "R2512", "5mR", {"1": "HB_OUT", "2": "VBAT"}, (231, 30), 90, mpn="5 mOhm 1% 2512 sense", desc="Battery current sense")
    # bulk caps: input node, H-bridge output, VBUS
    d.C("22u", "VIN_HB", "GND", (201, 26), 90, fp="C1210", mpn="22uF 25V X5R 1210")
    d.C("22u", "VIN_HB", "GND", (201, 32), 90, fp="C1210", mpn="22uF 25V X5R 1210")
    d.add("C_HB1", "CPOL", "100u 35V", {"1": "VIN_HB", "2": "GND"}, (200, 46), 0, mpn="100uF 35V polymer 6.3x5.8", desc="Charger input bulk")
    d.C("22u", "HB_OUT", "GND", (243.5, 26), 90, fp="C1210", mpn="22uF 25V X5R 1210")
    d.C("22u", "HB_OUT", "GND", (243.5, 32), 90, fp="C1210", mpn="22uF 25V X5R 1210")
    d.add("C_HB2", "CPOL", "100u 35V", {"1": "HB_OUT", "2": "GND"}, (250, 14), 0, mpn="100uF 35V polymer 6.3x5.8", desc="Charger output bulk")
    d.C("10u", "VBUS", "GND", (201, 16), 90, fp="C1210", mpn="10uF 25V X5R 1210")
    d.D("SMAJ24A", "GND", "VBUS", (197, 11), 0, fp="SMA", mpn="SMAJ24A TVS", desc="USB-C VBUS surge")
    n("USB-C CC1/CC2 go straight to the IP2368 (it is the PD sink); no external Rd resistors.")

    # ================================================================ power: battery -> fuse -> PFET -> shunt -> buck -> 5V1 -> 3V3  (right, middle)
    bx, by = 200, 80
    d.add("F1", "FUSE1812", "7.5A", {"1": "BAT_RAW", "2": "VBAT"}, (256, 141), 90, mpn="Littelfuse 0603/1812 7.5A slow", desc="Battery fuse")
    # reverse-polarity P-MOSFET (SO-8: 1-3 S, 4 G, 5-8 D): drain to battery, source to the load, gate to ground
    d.add("Q6", "SOIC8", "AO4407A", {"1": "VBAT_P", "2": "VBAT_P", "3": "VBAT_P", "4": "GND", "5": "VBAT", "6": "VBAT", "7": "VBAT", "8": "VBAT"}, (256, 124), 0, mpn="Alpha&Omega AO4407A", desc="Reverse-battery protection")
    # shunt for the INA226 (IN+ = battery side, IN- = load side)
    d.add("R_SH", "R2512", "5mR", {"1": "VBAT_P", "2": "VBAT_S"}, (256, 132), 90, mpn="5 mOhm 1% 2512 sense", desc="Battery monitor shunt")
    ina = {"1": "3V3", "2": "3V3", "3": "", "4": "SDA", "5": "SCL", "6": "3V3", "7": "GND", "8": "VBAT_S", "9": "VBAT_S", "10": "VBAT_P"}
    d.add("U3", "VSSOP10", "INA226AIDGSR", ina, (246, 126), 0, mpn="TI INA226AIDGSR", desc="Battery volts / amps, I2C 0x45 (A0 = A1 = VS)")
    d.C("100n", "3V3", "GND", (246, 121))
    # TPS54560 (HSOP-8): 1 BOOT 2 VIN 3 EN 4 RT/CLK 5 FB 6 COMP 7 GND 8 SW 9 EP
    tps = {"1": "BOOT", "2": "VBAT_S", "3": "EN_5V", "4": "RT", "5": "FB", "6": "COMP", "7": "GND", "8": "SW", "9": "GND"}
    d.add("U2", "HSOP8", "TPS54560DDAR", tps, (bx, by), 0, mpn="TI TPS54560DDAR", desc="5.1 V / 5 A buck")
    d.add("L2", "LPWR", "4.7uH 9A", {"1": "SW", "2": "5V1"}, (bx + 11, by + 1), 0, mpn="Bourns SRP7028A-4R7M", desc="5.1 V inductor")
    d.C("100n", "BOOT", "SW", (bx, by - 5.5))
    d.row([("R", "53.6k", "5V1", "FB"), ("R", "10k", "FB", "GND"), ("R", "162k", "RT", "GND"), ("R", "16.9k", "COMP", "COMP_C"), ("C", "4.7n", "COMP_C", "GND"), ("C", "68p", "COMP", "GND")], bx - 9, by + 6)
    n("TPS54560: FB divider 53.6k/10k = 5.09 V; RT 162k ~ 600 kHz; compensation 16.9k + 4.7n // 68p sized for ~88 uF ceramic output - check with the TI design procedure.")
    d.C("10u", "VBAT_S", "GND", (192, 78), 90, fp="C1210", mpn="10uF 25V X5R 1210")
    d.C("10u", "VBAT_S", "GND", (192, 73), 90, fp="C1210", mpn="10uF 25V X5R 1210")
    d.C("100n", "VBAT_S", "GND", (196.5, 74.5))
    for i in range(4):
        d.C("22u", "5V1", "GND", (219, 74 + i * 3.4), 0, fp="C0805", mpn="22uF 10V X5R 0805")
    d.add("C_5V1", "CPOL", "100u 10V", {"1": "5V1", "2": "GND"}, (220, 91), 0, mpn="100uF 10V polymer 6.3x5.8", desc="5.1 V bulk")
    # LTC2954-1 (TSOT-8): 1 VIN 2 PB 3 ONT 4 GND 5 INT 6 EN 7 PDT 8 KILL
    d.add("U15", "TSOT23-8", "LTC2954CTS8-1", {"1": "VBAT_P", "2": "PB", "3": "", "4": "GND", "5": "PWR_INT", "6": "EN_5V", "7": "PDT", "8": "PWR_KILL"}, (210, 100), 0, mpn="ADI LTC2954CTS8-1#TRMPBF", desc="Power button controller")
    d.row([("C", "1u", "VBAT_P", "GND"), ("C", "1.5u", "PDT", "GND", {"mpn": "1.5uF 16V 0603"}), ("R", "100k", "PWR_INT", "3V3"), ("R", "4.7k", "PWR_KILL", "3V3"), ("C", "100n", "PB", "GND")], 203, 105)
    n("Power button: tap = Linux shutdown (INT -> GPIO 4), Linux then drives GPIO 24 low = KILL; holding the button ~10 s (1.5 uF on PDT) forces the 5 V off.")
    # 3.3 V LDO TLV75533 (SOT-23-5: 1 IN 2 GND 3 EN 4 NC 5 OUT)
    d.add("U4", "SOT23-5", "TLV75533PDBVR", {"1": "5V1", "2": "GND", "3": "5V1", "4": "", "5": "3V3"}, (196, 118), 0, mpn="TI TLV75533PDBVR", desc="3.3 V 500 mA LDO")
    d.row([("C", "1u", "5V1", "GND"), ("C", "1u", "3V3", "GND"), ("C", "10u", "3V3", "GND")], 192, 123)
    # clean analog rails through ferrite beads
    d.L("FB 600R", "5V1", "5VA", (196, 112), 0, mpn="BLM21PG600SN1D", desc="Ferrite bead 600R@100MHz 1A")
    d.L("FB 600R", "3V3", "3V3A", (200, 112), 0, mpn="BLM21PG600SN1D", desc="Ferrite bead 600R@100MHz 1A")
    d.C("10u", "5VA", "GND", (196, 108))
    d.C("10u", "3V3A", "GND", (200, 108))
    d.add("TP1", "TP", "5V1", {"1": "5V1"}, (186, 66), desc="Test point 5.1 V")
    d.add("TP2", "TP", "3V3", {"1": "3V3"}, (186, 69), desc="Test point 3.3 V")
    d.add("TP3", "TP", "VBAT", {"1": "VBAT_P"}, (186, 72), desc="Test point battery")
    d.add("TP4", "TP", "GND", {"1": "GND"}, (186, 75), desc="Test point GND")

    # ================================================================ audio: DACs, ADC, preamp, headphone amp - top left behind the jacks
    # PCM5102A (TSSOP-20): 1 CPVDD 2 CAPP 3 CPGND 4 CAPM 5 VNEG 6 OUTL 7 OUTR 8 AVDD 9 AGND 10 DEMP 11 FLT 12 SCK 13 BCK 14 DIN 15 LRCK 16 FMT 17 XSMT 18 LDOO 19 DGND 20 DVDD
    ax, ay = 100, 36
    pcm5 = {"1": "3V3A", "2": "CAPP", "3": "GND", "4": "CAPM", "5": "VNEG", "6": "DAC1_L", "7": "DAC1_R", "8": "3V3A", "9": "GND", "10": "GND", "11": "GND",
            "12": "GND", "13": "I2S_BCK", "14": "I2S_DOUT", "15": "I2S_LRCK", "16": "GND", "17": "DAC_XSMT", "18": "LDOO", "19": "GND", "20": "3V3"}
    d.add("U5", "TSSOP20", "PCM5102APWR", pcm5, (ax, ay), 0, mpn="TI PCM5102APWR", desc="DAC 1 (outputs 3-4), I2S")
    d.row([("C", "2.2u", "CAPP", "CAPM"), ("C", "2.2u", "VNEG", "GND"), ("C", "2.2u", "LDOO", "GND"), ("C", "100n", "3V3A", "GND"), ("C", "10u", "3V3A", "GND"), ("C", "100n", "3V3", "GND")], ax - 6, ay - 6.5)
    d.R("100k", "DAC_XSMT", "3V3", (ax + 14, ay - 6.5))
    # output filters: 470R + 2.2n, then 100R to the tip; ring to GND through 100R (impedance balanced)
    for ch, net, out, gr, yy in (("L", "DAC1_L", "OUT3", "GND_R3", ay + 6), ("R", "DAC1_R", "OUT4", "GND_R4", ay + 8.6)):
        d.R("470R", net, "F1_" + ch, (ax - 6, yy))
        d.C("2.2n", "F1_" + ch, "GND", (ax - 3, yy))
        d.R("100R", "F1_" + ch, out, (ax, yy))
        d.R("100R", gr, "GND", (ax + 3, yy))
    # PCM1808 (TSSOP-14): 1 VREF 2 AGND 3 VCC 4 VDD 5 DGND 6 SCKI 7 LRCK 8 BCK 9 DOUT 10 MD0 11 MD1 12 FMT 13 VINL 14 VINR  - master, 256fs, I2S
    px, py = 128, 36
    pcm18 = {"1": "ADC_VREF", "2": "GND", "3": "5VA", "4": "3V3", "5": "GND", "6": "ADC_SCK", "7": "ADC_LRCK", "8": "ADC_BCK", "9": "ADC_DOUT", "10": "3V3", "11": "3V3", "12": "GND", "13": "ADC_INL", "14": "ADC_INR"}
    d.add("U7", "TSSOP14", "PCM1808PWR", pcm18, (px, py), 0, mpn="TI PCM1808PWR", desc="Instrument ADC, I2S master")
    d.row([("C", "10u", "ADC_VREF", "GND"), ("C", "100n", "5VA", "GND"), ("C", "10u", "5VA", "GND"), ("C", "100n", "3V3", "GND"), ("C", "1u", "ADC_INR", "GND")], px - 5, py - 6)
    d.row([("R", "33R", "ADC_BCK", "I2S_BCK"), ("R", "33R", "ADC_LRCK", "I2S_LRCK"), ("R", "33R", "ADC_DOUT", "I2S_DIN")], px - 3, py + 6)
    d.add("X1", "OSC3225", "12.288MHz", {"1": "3V3", "2": "GND", "3": "ADC_SCK", "4": "3V3"}, (126.5, 27.2), 0, mpn="12.288 MHz 3.3 V oscillator 3225", desc="ADC master clock")
    d.C("100n", "3V3", "GND", (130, 27.2))
    # instrument plug detect: ESD + a little filtering right behind the jack
    d.D("PESD5V0S1UB", "GND", "INST_DET", (118.5, 27.5), 90, fp="SOD523", mpn="Nexperia PESD5V0S1UB")
    d.C("100n", "INST_DET", "GND", (121.5, 27.5))
    # preamp OPA1678 (SOIC-8): 1 OUTA 2 -INA 3 +INA 4 V- 5 +INB 6 -INB 7 OUTB 8 V+   on 5VA, biased at 2.5 V
    ox, oy = 150, 36
    d.add("U8", "SOIC8", "OPA1678IDR", {"1": "PRE_A", "2": "PRE_AN", "3": "PRE_AP", "4": "GND", "5": "PRE_A", "6": "PRE_B", "7": "PRE_B", "8": "5VA"}, (ox, oy), 0, mpn="TI OPA1678IDR", desc="Instrument preamp")
    d.row([("C", "100n", "INST_IN", "IN_AC"), ("R", "1M", "IN_AC", "VBIAS", {"mpn": "1M 1% 0603"}), ("R", "100R", "IN_AC", "PRE_AP"), ("R", "100k", "5VA", "VBIAS"), ("R", "100k", "VBIAS", "GND"), ("C", "10u", "VBIAS", "GND")], ox - 7, oy - 6)
    d.row([("R", "10k", "PRE_AN", "VBIAS"), ("R", "30k", "PRE_A", "PRE_AN", {"mpn": "30k 1% 0603"}), ("R", "4.7k", "PRE_B", "ADC_RC"), ("C", "1n", "ADC_RC", "GND"), ("C", "1u", "ADC_RC", "ADC_INL"), ("C", "100n", "5VA", "GND")], ox - 7, oy + 6)
    d.add("JP1", "SJ", "GAIN 0dB", {"1": "PRE_A", "2": "PRE_AN"}, (ox + 7.5, oy), 90, desc="Close = 0 dB (active pickups); open = +12 dB")
    d.C("100p", "PRE_A", "PRE_AN", (ox + 7.5, oy + 4))
    # PCM2706C (TQFP-32) self-powered 3.3 V: see the pin table in the spec
    ux, uy = 60, 36
    pcm27 = {"1": "GND", "2": "3V3A", "3": "USB2_5V", "4": "", "5": "", "6": "", "7": "", "8": "", "9": "GND", "10": "3V3", "11": "", "12": "XTI", "13": "XTO", "14": "", "15": "ROM_DT",
             "16": "GND", "17": "", "18": "", "19": "", "20": "GND", "21": "3V3", "22": "USB2_DM", "23": "USB2_DP", "24": "3V3", "25": "GND", "26": "GND", "27": "3V3A", "28": "DAC2_L", "29": "DAC2_R", "30": "3V3A", "31": "GND", "32": "VCOM"}
    d.add("U6", "TQFP32", "PCM2706CPJTR", pcm27, (ux, uy), 0, mpn="TI PCM2706CPJTR", desc="DAC 2 (outputs 5-6 + headphones), USB")
    d.add("Y1", "XTAL3225", "12MHz", {"1": "XTI", "2": "GND", "3": "XTO", "4": "GND"}, (ux - 9, uy + 4), 0, mpn="12 MHz 3225 crystal 18pF", desc="USB DAC crystal")
    d.row([("C", "22p", "XTI", "GND"), ("C", "22p", "XTO", "GND"), ("R", "10k", "ROM_DT", "3V3"), ("C", "10u", "VCOM", "GND")], ux - 9, uy + 8)
    d.row([("C", "100n", "3V3", "GND"), ("C", "10u", "3V3", "GND"), ("C", "100n", "3V3A", "GND"), ("C", "10u", "3V3A", "GND"), ("C", "100n", "3V3A", "GND")], ux - 6, uy - 7.5)
    # DAC 2 outputs: 10u coupling (self-powered outputs sit at VCOM), 47k bleed, 100R to the jacks, ring 100R to GND
    for ch, net, out, gr, yy in (("L", "DAC2_L", "OUT5", "GND_R5", uy + 7.5), ("R", "DAC2_R", "OUT6", "GND_R6", uy + 10.1)):
        d.C("10u", net, "LINE_" + ch, (ux + 4, yy))
        d.R("47k", "LINE_" + ch, "GND", (ux + 7, yy))
        d.R("100R", "LINE_" + ch, out, (ux + 10, yy))
        d.R("100R", gr, "GND", (ux + 13, yy))
    n("Outputs 5-6 are also the headphone source: whatever the app routes to 5-6 is what the headphone jack plays.")
    # headphone amp TPA6132A2 (WQFN-16): 1 INL- 2 INL+ 3 INR+ 4 INR- 5 OUTR 6 G0 7 G1 8 HPVSS 9 CPN 10 PGND 11 CPP 12 HPVDD 13 EN 14 VDD 15 SGND 16 OUTL 17 EP
    hx, hy = 34, 34
    d.add("U14", "WQFN16", "TPA6132A2RTER", {"1": "HPIN_L", "2": "GND", "3": "GND", "4": "HPIN_R", "5": "HP_R", "6": "HP_G0", "7": "HP_G1", "8": "HPVSS", "9": "CPN", "10": "GND", "11": "CPP",
                                             "12": "HPVDD", "13": "HP_EN", "14": "3V3", "15": "GND", "16": "HP_L", "17": "GND"}, (hx, hy), 0, mpn="TI TPA6132A2RTER", desc="Headphone amp")
    d.row([("C", "1u", "CPP", "CPN"), ("C", "1u", "HPVSS", "GND"), ("C", "2.2u", "HPVDD", "GND"), ("C", "1u", "3V3", "GND"), ("R", "100k", "PG_5V", "HP_EN"), ("C", "10u", "HP_EN", "GND")], hx - 6, hy - 6)
    d.row([("C", "1u", "HPVOL_L", "HPIN_L"), ("C", "1u", "HPVOL_R", "HPIN_R"), ("R", "0R", "HP_G0", "GND"), ("R", "0R", "HP_G1", "GND")], hx - 4, hy + 6)
    d.R("0R", "HP_G0", "3V3", (hx + 9.5, hy + 6), dnp=True)
    d.R("0R", "HP_G1", "3V3", (hx + 12.7, hy + 6), dnp=True)
    n("TPA6132A2 gain pins G0/G1 both to GND (0R fitted); 0R to 3V3 footprints are left unfitted - pick the gain from the datasheet table.")
    # PG from the buck -> headphone enable (so there is no thump): TPS54560 has no PG pin, so EN rises with 3V3 through 100k + 10u (~1 s)
    d.R("0R", "3V3", "PG_5V", (hx + 14, hy - 6))
    # headphone volume: dual-gang 10k log (RK09L double): gang 1 = pins 1-3, gang 2 = pins 4-6; 1/4 = CCW end, 2/5 = wiper, 3/6 = CW end
    d.add("RV9", "POT_DUAL", "A10K dual", {"1": "GND", "2": "HPVOL_L", "3": "LINE_L", "4": "GND", "5": "HPVOL_R", "6": "LINE_R", "MP": "GND"}, (8, 34), 0, mpn="Alps RK09L12D0A1S (A10K dual) 9mm vertical", desc="Headphone volume")

    # ================================================================ controls: knobs, faders, ADC, lights, expander - left/right edges and centre-bottom
    knob_names = ["Left knob 1", "Left knob 2", "Left knob 3", "Right knob 1", "Right knob 2", "Right knob 3"]
    knob_pos = [(8, 52), (8, 78), (8, 104), (248, 52), (248, 78), (248, 104)]
    for i in range(6):
        ref = "RV%d" % (i + 1)
        d.add(ref, "POT_PUSH", "B10K push", {"1": "GND", "2": "KNOB%d_W" % (i + 1), "3": "3V3A", "MP": "GND", "S1": "KCLK%d" % (i + 1), "S2": "GND"}, knob_pos[i], 0, mpn="Alpha RV09 / RD901F B10K vertical with push switch", desc=knob_names[i])
        kx, ky = knob_pos[i]
        d.R("1k", "KNOB%d_W" % (i + 1), "ADC_CH%d" % i, (kx + 3, ky + 11.5), 0)
        d.C("100n", "ADC_CH%d" % i, "GND", (kx + 6.2, ky + 11.5), 0)
        d.C("100n", "KCLK%d" % (i + 1), "GND", (kx + 9.4, ky + 11.5), 0)
    # faders: Bourns PTA4543 (1 and 3 = ends, 2 = wiper), 45 mm travel, vertical along the edge
    for i, (ref, x, name) in enumerate((("RV7", 30, "Left fader"), ("RV8", 234, "Right fader"))):
        d.add(ref, "FADER", "10k lin slide", {"1": "GND", "2": "FADER%d_W" % (i + 1), "3": "3V3A", "MP": "GND"}, (x, 112), 90, mpn="Bourns PTA4543-2015DPB103", desc=name)
        d.R("1k", "FADER%d_W" % (i + 1), "ADC_CH%d" % (6 + i), (x + (9 if i == 0 else -9), 54), 90)
        d.C("100n", "ADC_CH%d" % (6 + i), "GND", (x + (9 if i == 0 else -9), 58), 90)
    # MCP3208 (SOIC-16): 1-8 CH0-7, 9 DGND, 10 CS, 11 DIN, 12 DOUT, 13 CLK, 14 AGND, 15 VREF, 16 VDD
    mx, my = 60, 124
    d.add("U9", "SOIC16", "MCP3208-CI/SL", {**{str(i + 1): "ADC_CH%d" % i for i in range(8)}, "9": "GND", "10": "SPI_CE0", "11": "SPI_MOSI", "12": "SPI_MISO", "13": "SPI_SCLK", "14": "GND", "15": "3V3A", "16": "3V3"}, (mx, my), 0, mpn="Microchip MCP3208-CI/SL", desc="Knob / fader ADC, SPI")
    d.row([("C", "100n", "3V3", "GND"), ("C", "100n", "3V3A", "GND"), ("C", "10u", "3V3A", "GND")], mx - 3, my - 8)
    # PCA9685 (TSSOP-28): 1-5 A0-A4, 6-13 LED0-7, 14 GND, 15-22 LED8-15, 23 EXTCLK, 24 A5, 25 OE, 26 SCL, 27 SDA, 28 VDD   address 0x41 (A0 high)
    lx, ly = 82, 124
    pca = {"1": "3V3", "2": "GND", "3": "GND", "4": "GND", "5": "GND", "14": "GND", "23": "GND", "24": "GND", "25": "GND", "26": "SCL", "27": "SDA", "28": "3V3"}
    for i in range(8):
        pca[str(6 + i)] = "LED%d" % (i + 1)
    d.add("U10", "TSSOP28", "PCA9685PW", pca, (lx, ly), 0, mpn="NXP PCA9685PW", desc="Footswitch lights, I2C 0x41")
    d.C("100n", "3V3", "GND", (lx - 4, ly - 8))
    d.C("10u", "3V3", "GND", (lx - 1, ly - 8))
    # footswitch LED anodes: 5.1 V through 330R each (LED_A is the common 5 V side on the connector, the resistor sits on the LED- side... no: one resistor per LED)
    # -> each connector pin 3 is 5V1 straight, pin 4 goes through 330R to its PCA9685 channel so every LED has its own resistor.
    for p in d.parts:
        if p["fp"] == "XH4" and p["ref"].startswith("J1") or p["fp"] == "XH4" and p["ref"].startswith("J2"):
            p["pins"]["3"] = "5V1"
            p["pins"]["4"] = "LEDK%s" % p["value"].split()[-1]
    for i in range(8):
        d.R("330R", "LEDK%d" % (i + 1), "LED%d" % (i + 1), (30 + 24 * i + 8, 148.5), 0, mpn="330R 0603")
    # MCP23017 (SSOP-28): 1-8 GPB0-7, 9 VDD, 10 VSS, 11 NC, 12 SCL, 13 SDA, 14 NC, 15-17 A0-A2, 18 RESET, 19 INTB, 20 INTA, 21-28 GPA0-7   address 0x20
    ex, ey = 106, 124
    mcp = {"9": "3V3", "10": "GND", "12": "SCL", "13": "SDA", "15": "GND", "16": "GND", "17": "GND", "18": "EXP_RST"}
    for i in range(6):
        mcp[str(21 + i)] = "KCLK%d" % (i + 1)
    mcp["27"] = "EXT_A"
    mcp["28"] = "EXT_B"
    mcp["1"] = "CHG_LED1"
    d.add("U13", "SSOP28", "MCP23017-E/SS", mcp, (ex, ey), 0, mpn="Microchip MCP23017-E/SS", desc="Knob clicks + external footswitches, I2C 0x20")
    d.row([("C", "100n", "3V3", "GND"), ("R", "10k", "EXP_RST", "3V3"), ("R", "10k", "EXT_A", "3V3"), ("R", "10k", "EXT_B", "3V3")], ex - 5, ey - 8.5)
    d.D("PESD5V0S1UB", "GND", "EXT_A", (ex + 7.5, ey - 8.5), 90, fp="SOD523", mpn="Nexperia PESD5V0S1UB")
    d.D("PESD5V0S1UB", "GND", "EXT_B", (ex + 10, ey - 8.5), 90, fp="SOD523", mpn="Nexperia PESD5V0S1UB")
    # HAT ID EEPROM CAT24C32 (SOIC-8): 1-3 A0-A2, 4 VSS, 5 SDA, 6 SCL, 7 WP, 8 VCC
    d.add("U12", "SOIC8", "CAT24C32WI-GT3", {"1": "GND", "2": "GND", "3": "GND", "4": "GND", "5": "ID_SD", "6": "ID_SC", "7": "EEP_WP", "8": "3V3"}, (132, 124), 0, mpn="onsemi CAT24C32WI-GT3", desc="HAT ID EEPROM")
    d.C("100n", "3V3", "GND", (127.5, 118.5))
    d.add("JP2", "SJ", "EEPROM WP", {"1": "EEP_WP", "2": "3V3"}, (136, 118.5), 0, desc="Close to write-protect the HAT EEPROM")
    d.R("10k", "EEP_WP", "GND", (132, 130), 0)
    # MIDI: 6N138 (SOIC-8): 1 NC 2 anode 3 cathode 4 NC 5 GND 6 Vo 7 Vb 8 Vcc
    mdx, mdy = 176, 18
    d.add("U11", "SOIC8", "6N138S", {"1": "", "2": "MIDI_A", "3": "MIDI_K", "4": "", "5": "GND", "6": "MIDI_RX", "7": "", "8": "5V1"}, (mdx, mdy), 0, mpn="6N138S (SOIC-8)", desc="MIDI in optocoupler")
    d.row([("R", "220R", "MIDI_IN_T", "MIDI_A", {"mpn": "220R 0603"}), ("R", "2.2k", "MIDI_RX", "3V3"), ("C", "100n", "5V1", "GND"), ("R", "10R", "MIDI_TX", "MIDI_OUT_R"), ("R", "33R", "3V3", "MIDI_OUT_T")], mdx - 6, mdy + 5.5)
    d.D("1N4148W", "MIDI_K", "MIDI_A", (mdx - 7, mdy), 90, fp="SOD123", mpn="1N4148W")
    # tie the opto cathode to the ring
    d.R("0R", "MIDI_K", "MIDI_IN_R", (184, mdy + 9), 0)
    # fan switch AO3400 (SOT-23: 1 G 2 S 3 D) + flyback; status LED
    d.add("Q7", "SOT23", "AO3400A", {"1": "FAN_G", "2": "GND", "3": "FAN_N"}, (218, 148), 0, mpn="Alpha&Omega AO3400A", desc="Fan switch")
    d.R("100R", "FAN_CTL", "FAN_G", (212, 145), 90)
    d.R("10k", "FAN_G", "GND", (212, 150), 90)
    d.D("1N4148W", "FAN_N", "5V1", (222, 143), 0, fp="SOD123", mpn="1N4148W")
    d.add("D_ST", "LED0603", "GREEN", {"1": "GND", "2": "LED_ST_A"}, (150, 128), 0, mpn="0603 green LED", desc="Status LED (driver running)")
    d.R("1k", "STATUS_LED", "LED_ST_A", (150, 131), 0)
    # Pi 3.3 V pins are not used by the board (own LDO) - a 0R option ties them for the ID EEPROM bus pull-ups' reference if ever needed
    d.R("0R", "PI_3V3", "3V3", (150, 124), 0, dnp=True)
    n("The Pi's own 3.3 V pins are left unconnected (DNP 0R to the board's 3V3): both rails are 3.3 V, so I2C and SPI levels match without tying them.")

    # ================================================================ mounting holes
    for (x, y) in ((5, 5), (W - 5, 5), (5, H - 5), (W - 5, H - 5), (194, 22), (118, 147)):
        d.add("H?", "HOLE_M3", "M3", {}, (x, y), desc="Enclosure standoff")
    # Raspberry Pi 4 holes: pattern relative to the header (computed in build.py from the header's placement)
    return d


if __name__ == "__main__":
    d = build()
    nets = d.nets()
    print(len(d.parts), "parts,", len(nets), "nets")
    singles = {k: v for k, v in nets.items() if len(v) == 1}
    print("single-pin nets:", sorted(singles))
