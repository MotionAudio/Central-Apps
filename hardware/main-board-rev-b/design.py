#!/usr/bin/python3
"""
Central Pedal main board, rev B - the whole board as data.

Every part: reference, footprint, value, LCSC number where one exists (PCBWay sources the rest by manufacturer part
number), and which net each pad is on.  Placement is here too (mm, origin top-left, y down).  build.py turns this
into a KiCad board; route.py / fanout.py / maze.py route it; export.py writes the fab package.

Board: 390 x 278 mm, 4 layers.  Top edge (y = 0) is the back panel.  Front view = component side F.
Rails:  USB-C PD (5-15 V) -> HUSB238A (PD sink) + BQ25798 (2S buck-boost charger, NVDC) -> VSYS (~7-8.6 V)
        VSYS -> TPS565208 x3 -> 5V1 (Pi + logic), 5V2 (screens, USB-A, lights, fan), 3V3 (digital)
        5V1 -> TLV75533 -> 3V3A (clean analog)       battery: JST-VH -> PTC 7.5 A -> AO4407A -> 5 mR shunt -> BQ BAT
Plate: the enclosure top plate sits 15.5 mm above this board (footswitch bodies are 15.25 mm tall).
"""

W, H = 390.0, 278.0

# ---------------------------------------------------------------- footprints  (lib, name); "custom" = custom.pretty
FP = {
    "R0603": ("Resistor_SMD", "R_0603_1608Metric"),
    "R2512": ("Resistor_SMD", "R_2512_6332Metric"),
    "C0603": ("Capacitor_SMD", "C_0603_1608Metric"),
    "C0805": ("Capacitor_SMD", "C_0805_2012Metric"),
    "C1210": ("Capacitor_SMD", "C_1210_3225Metric"),
    "CPOL": ("Capacitor_SMD", "CP_Elec_6.3x5.8"),
    "L0805": ("Inductor_SMD", "L_0805_2012Metric"),
    "LPWR": ("Inductor_SMD", "L_Sunlord_MWSA0603S"),
    "LED0603": ("LED_SMD", "LED_0603_1608Metric"),
    "LED5": ("LED_THT", "LED_D5.0mm"),
    "SOD123": ("Diode_SMD", "D_SOD-123"),
    "SOD523": ("Diode_SMD", "D_SOD-523"),
    "SMA": ("Diode_SMD", "D_SMA"),
    "FUSE1812": ("Fuse", "Fuse_1812_4532Metric"),
    "SOT23": ("Package_TO_SOT_SMD", "SOT-23"),
    "SOT23-5": ("Package_TO_SOT_SMD", "SOT-23-5"),
    "SOT23-6": ("Package_TO_SOT_SMD", "SOT-23-6"),
    "TSOT23-6": ("Package_TO_SOT_SMD", "TSOT-23-6"),
    "TSOT23-8": ("Package_TO_SOT_SMD", "TSOT-23-8"),
    "SOIC8": ("Package_SO", "SOIC-8_3.9x4.9mm_P1.27mm"),
    "SMD8_OPTO": ("custom", "Opto_6N138S_SMD8"),
    "TSSOP14": ("Package_SO", "TSSOP-14_4.4x5mm_P0.65mm"),
    "TSSOP20": ("Package_SO", "TSSOP-20_4.4x6.5mm_P0.65mm"),
    "TSSOP24": ("Package_SO", "TSSOP-24_4.4x7.8mm_P0.65mm"),
    "TSSOP28": ("Package_SO", "TSSOP-28_4.4x9.7mm_P0.65mm"),
    "SSOP28": ("Package_SO", "SSOP-28_5.3x10.2mm_P0.65mm"),
    "VSSOP10": ("Package_SO", "VSSOP-10_3x3mm_P0.5mm"),
    "TQFP32": ("Package_QFP", "TQFP-32_7x7mm_P0.8mm"),
    "QFN29_BQ": ("custom", "BQ25798_VQFN-29_4x4"),
    "QFN16_PD": ("custom", "HUSB238A_QFN-16_3x3"),
    "QFN20_HP": ("custom", "TPA6130A2_QFN-20_4x4"),
    "SOP16_HUB": ("custom", "SL2.1A_SOP-16"),
    "XTAL3225": ("Crystal", "Crystal_SMD_3225-4Pin_3.2x2.5mm"),
    "OSC3225": ("Oscillator", "Oscillator_SMD_Abracon_ASE-4Pin_3.2x2.5mm"),
    "USBC": ("Connector_USB", "USB_C_Receptacle_HRO_TYPE-C-31-M-12"),
    "USBA": ("custom", "USB_A_Horizontal_AF90"),
    "PI40": ("Connector_PinSocket_2.54mm", "PinSocket_2x20_P2.54mm_Vertical"),
    "PH2": ("Connector_JST", "JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical"),
    "PH4": ("Connector_JST", "JST_PH_B4B-PH-K_1x04_P2.00mm_Vertical"),
    "VH2": ("Connector_JST", "JST_VH_B2P-VH_1x02_P3.96mm_Vertical"),
    "JACK635": ("custom", "Jack_6.35mm_Neutrik_NMJ6HCD2_Horizontal"),
    "JACK35": ("Connector_Audio", "Jack_3.5mm_PJ320D_Horizontal"),
    "ENC": ("custom", "Encoder_PEC11R_Vertical"),
    "FADER": ("custom", "Fader_PTA6043"),
    "FSW": ("custom", "Footswitch_SPST_PCB"),
    "OLED": ("custom", "OLED_091_I2C_Socket"),
    "TACT_RA": ("Button_Switch_THT", "SW_Tactile_SPST_Angled_PTS645Vx39-2LFS"),
    "SJ": ("Jumper", "SolderJumper-2_P1.3mm_Open_RoundedPad1.0x1.5mm"),
    "TP": ("TestPoint", "TestPoint_Pad_D1.5mm"),
    "HOLE_M3": ("MountingHole", "MountingHole_3.2mm_M3"),
    "HOLE_M25": ("MountingHole", "MountingHole_2.7mm"),
}

# LCSC numbers for the passives (checked against JLCPCB's library on 2026-11-08; "base" parts where one exists)
LCSC = {
    ("R0603", "0R"): "C21189", ("R0603", "10R"): "C22859", ("R0603", "22R"): "C23345", ("R0603", "33R"): "C23140", ("R0603", "100R"): "C22775",
    ("R0603", "150R"): "C22808", ("R0603", "220R"): "C22962", ("R0603", "270R"): "C22966", ("R0603", "330R"): "C23138", ("R0603", "470R"): "C23179",
    ("R0603", "1k"): "C21190", ("R0603", "2.2k"): "C4190", ("R0603", "4.7k"): "C23162", ("R0603", "8.2k"): "C25981", ("R0603", "10k"): "C25804",
    ("R0603", "11k"): "C25950", ("R0603", "15k"): "C22809", ("R0603", "21k"): "C22956", ("R0603", "30k"): "C22984", ("R0603", "33.2k"): "C23003",
    ("R0603", "47k"): "C25819", ("R0603", "57.6k"): "C23082", ("R0603", "100k"): "C25803", ("R0603", "900k"): "C55585693", ("R0603", "1M"): "C22935",
    ("C0603", "22p"): "C1653", ("C0603", "100p"): "C14858", ("C0603", "1n"): "C1588", ("C0603", "2.2n"): "C1604", ("C0603", "10n"): "C57112",
    ("C0603", "33n"): "C21117", ("C0603", "47n"): "C1622", ("C0603", "100n"): "C14663", ("C0603", "1u"): "C5673", ("C0603", "2.2u"): "C23630",
    ("C0603", "4.7u"): "C69335", ("C0603", "10u"): "C19702", ("C0805", "22u"): "C29277", ("C0805", "10u"): "C15850", ("C1210", "22u"): "C52306",
    ("CPOL", "100u 10V"): "C48971041", ("R2512", "5mR"): "C154688", ("L0805", "FB 60R"): "C18305",
    ("LPWR", "2.2uH"): "C408445", ("LPWR", "3.3uH"): "C408446",
    ("SOD123", "1N4148W"): "C81598", ("SOD523", "PESD5V0S1UB"): "C85390", ("SMA", "SMAJ24A"): "C113962", ("SOT23-6", "USBLC6-2SC6"): "C7519",
    ("FUSE1812", "7.5A PTC"): "C3039825", ("XTAL3225", "12MHz"): "C9002", ("OSC3225", "12.288MHz"): "C2896602",
    ("USBC", "USB-C"): "C165948", ("USBA", "USB-A"): "C2345", ("JACK35", "3.5mm TRRS"): "C95562",
    ("PH2", "JST PH 2"): "C5251182", ("PH4", "JST PH 4"): "C131334", ("VH2", "JST VH 2"): "C160315",
    ("TACT_RA", "POWER"): "C285519",
}

PI_PIN = {  # BCM GPIO -> 40-pin header pin
    2: 3, 3: 5, 4: 7, 14: 8, 15: 10, 17: 11, 18: 12, 27: 13, 22: 15, 23: 16, 24: 18, 10: 19, 9: 21, 25: 22, 11: 23, 8: 24,
    7: 26, 0: 27, 1: 28, 5: 29, 6: 31, 12: 32, 13: 33, 19: 35, 16: 36, 26: 37, 20: 38, 21: 40,
}

# ---- geometry shared with build.py / the layout drawing
PITCH = 48.0                      # footswitch pitch
FSW_X = [W / 2 - 3.5 * PITCH + PITCH * i for i in range(8)]     # 27 .. 363
FSW_Y, FSW9_Y = 256.0, 202.0
PI_HEADER = (194.5, 63.8)         # centre of the 2x20 socket on the back (Pi 4 behind the board, component side toward it)
Y_HUB_AT = (144.0, 84.0)          # hub crystal: left of the hub, clear of the display-ribbon slot


class Design:
    def __init__(self):
        self.parts = []
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

    def R(self, value, a, b, at, rot=0, fp="R0603", **kw):
        return self.add("R?", fp, value, {"1": a, "2": b}, at, rot, **kw)

    def C(self, value, a, b, at, rot=0, fp="C0603", **kw):
        return self.add("C?", fp, value, {"1": a, "2": b}, at, rot, **kw)

    def L(self, value, a, b, at, rot=0, fp="L0805", **kw):
        return self.add("FB?", fp, value, {"1": a, "2": b}, at, rot, **kw)

    def D(self, value, anode, cathode, at, rot=0, fp="SOD123", **kw):   # KiCad diode footprints: pad 1 = cathode, pad 2 = anode
        return self.add("D?", fp, value, {"1": cathode, "2": anode}, at, rot, **kw)

    def row(self, items, x, y, dx=3.2, rot=0, **kw0):
        refs = []
        for i, it in enumerate(items):
            kind, value, a, b = it[:4]
            kw = dict(kw0)
            kw.update(it[4] if len(it) > 4 else {})
            fn = {"R": self.R, "C": self.C, "L": self.L}[kind]
            refs.append(fn(value, a, b, (x + i * dx, y), rot, **kw))
        return refs

    def col(self, items, x, y, dy=3.2, rot=90, **kw0):
        refs = []
        for i, it in enumerate(items):
            kind, value, a, b = it[:4]
            kw = dict(kw0)
            kw.update(it[4] if len(it) > 4 else {})
            fn = {"R": self.R, "C": self.C, "L": self.L}[kind]
            refs.append(fn(value, a, b, (x, y + i * dy), rot, **kw))
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

    # ================================================================ BACK PANEL (top edge)
    # power button: right-angle tact, actuator through the back panel
    d.add("SW_PWR", "TACT_RA", "POWER", {"1": "PB", "2": "GND"}, (14, 2.6), 0, mpn="C&K PTS645VK39-2 LFS", desc="Power button (back panel)")
    d.C("100n", "PB", "GND", (14, 8.5))
    # USB-C: power + PD only (data to the charger's BC1.2 pins)
    usb = {"A1": "GND", "B1": "GND", "A12": "GND", "B12": "GND", "A4": "VBUS", "B4": "VBUS", "A9": "VBUS", "B9": "VBUS",
           "A5": "CC1", "B5": "CC2", "A6": "USB_DP", "B6": "USB_DP", "A7": "USB_DM", "B7": "USB_DM", "A8": "", "B8": "", "S1": "GND"}
    d.add("J_USBC", "USBC", "USB-C", usb, (30, 3.65), 180, mpn="HRO TYPE-C-31-M-12", desc="USB-C PD power / charge input")
    d.D("SMAJ24A", "GND", "VBUS", (30, 13.5), 0, fp="SMA", mpn="SMAJ24A TVS", desc="VBUS surge clamp")
    # USB-A host port (from the hub), 5V2 through a PTC
    d.add("J_USBA", "USBA", "USB-A", {"1": "USBA_5V", "2": "USBA_DM", "3": "USBA_DP", "4": "GND", "SH1": "GND", "SH2": "GND"}, (50, 11.6), 180, mpn="USB-A receptacle, right angle, THT (Jing Extension 902-131A1011D10100)", desc="USB-A host port (thumb drive / MIDI controller)")
    d.add("F_USBA", "FUSE1812", "0.75A PTC", {"1": "5V2", "2": "USBA_5V"}, (50, 18.5), 0, mpn="Bourns MF-MSMF075-2 (0.75 A hold PTC 1812)", lcsc="C84140", desc="USB-A port fuse")
    d.add("D_USBA", "SOT23-6", "USBLC6-2SC6", {"1": "USBA_DP", "2": "GND", "3": "USBA_DM", "4": "USBA_DM", "5": "USBA_5V", "6": "USBA_DP"}, (58.5, 18.5), 0, mpn="ST USBLC6-2SC6", desc="USB-A ESD")
    d.C("100n", "USBA_5V", "GND", (42, 18.5))

    # 1/4-inch jacks, 21 mm pitch, centred: EXT A, INST A, OUT 1-6, INST B, EXT B   (NMJ6HCD2 rotated 270: plug enters from -y)
    jacks = [("J_EXTA", "EXTA_T", "EXTA_R", "GND", "", "", "Ext footswitch A (TRS)"),
             ("J_INA", "INST_A", "INST_DET_A", "GND", "GND", "", "Instrument in A"),
             ("J_OUT1", "OUT1", "GND_R1", "GND", "", "", "Output 1"), ("J_OUT2", "OUT2", "GND_R2", "GND", "", "", "Output 2"),
             ("J_OUT3", "OUT3", "GND_R3", "GND", "", "", "Output 3"), ("J_OUT4", "OUT4", "GND_R4", "GND", "", "", "Output 4"),
             ("J_OUT5", "OUT5", "GND_R5", "GND", "", "", "Output 5"), ("J_OUT6", "OUT6", "GND_R6", "GND", "", "", "Output 6"),
             ("J_INB", "INST_B", "INST_DET_B", "GND", "GND", "", "Instrument in B"),
             ("J_EXTB", "EXTB_T", "EXTB_R", "GND", "", "", "Ext footswitch B (TRS)")]
    JX = {}
    for i, (ref, t, r, s, tn, rn, desc) in enumerate(jacks):
        x = W / 2 - 94.5 + 21 * i
        JX[ref] = x
        d.add(ref, "JACK635", "1/4in TRS", {"T": t, "R": r, "S": s, "TN": tn, "RN": rn, "SN": ""}, (x, 4.5), 270, mpn="Neutrik NMJ6HCD2", lcsc="C368502", desc=desc)
    # impedance-balanced outputs: ring to ground through 100R, right behind each jack
    for k in range(1, 7):
        d.R("100R", "GND_R%d" % k, "GND", (JX["J_OUT%d" % k] - 6, 27), 0)
    # 3.5 mm: MIDI IN, MIDI OUT, PHONES (PJ-320D, type-A MIDI: tip = current source, ring = sink)
    d.add("J_MIDI_IN", "JACK35", "3.5mm TRRS", {"T": "MIDI_IN_T", "R1": "MIDI_IN_R", "R2": "", "S": ""}, (W - 40, 7.5), 270, mpn="PJ-320D-4A", desc="MIDI IN (TRS type A)")
    d.add("J_MIDI_OUT", "JACK35", "3.5mm TRRS", {"T": "MIDI_OUT_T", "R1": "MIDI_OUT_R", "R2": "", "S": "GND"}, (W - 28, 7.5), 270, mpn="PJ-320D-4A", desc="MIDI OUT (TRS type A)")
    d.add("J_PHONES", "JACK35", "3.5mm TRRS", {"T": "HP_L", "R1": "HP_R", "R2": "GND", "S": "GND"}, (W - 16, 7.5), 270, mpn="PJ-320D-4A", desc="Headphones")

    # ================================================================ RASPBERRY PI header (back side), behind the 7-inch screen
    pi = {str(p): "" for p in range(1, 41)}
    for p in (2, 4):
        pi[str(p)] = "5V1"
    for p in (6, 9, 14, 20, 25, 30, 34, 39):
        pi[str(p)] = "GND"
    pi["1"] = pi["17"] = "PI_3V3"
    gpio_net = {
        2: "SDA", 3: "SCL", 0: "ID_SD", 1: "ID_SC", 14: "MIDI_TX", 15: "MIDI_RX", 18: "I2S_BCK", 19: "I2S_LRCK", 20: "I2S_DIN", 21: "I2S_DOUT",
        5: "GPIO_FS1", 6: "GPIO_FS2", 7: "GPIO_FS3", 8: "GPIO_FS4", 9: "GPIO_FS5", 10: "GPIO_FS6", 11: "GPIO_FS7", 16: "GPIO_FS8", 17: "GPIO_FS9", 22: "GPIO_FS10",
        12: "PWM_L", 13: "PWM_R", 4: "PWR_INT", 24: "PWR_KILL", 23: "EXP1_INT", 25: "EXP2_INT", 26: "FAN_CTL", 27: "DAC_XSMT",
    }
    for g, net in gpio_net.items():
        pi[str(PI_PIN[g])] = net
    d.add("J1", "PI40", "RASPBERRY PI 4", pi, PI_HEADER, 90, side="B", mpn="2x20 female header 2.54 mm, 8.5 mm tall (Pi on ~20 mm M2.5 standoffs with a 2x20 extra-long stacking header on its GPIO pins)", lcsc="C5124634", desc="Raspberry Pi 4 GPIO (Pi behind the board)")
    d.R("0R", "PI_3V3", "3V3", (176, 73), 0, dnp=True)
    n("The Pi's own 3.3 V pins are not tied to the board's 3V3 (DNP 0R): both are 3.3 V, so I2C/UART/I2S levels match without joining the rails.")

    # ================================================================ POWER: USB-C PD sink (left strip) + BQ25798 charger (under the screen, top-left)
    # HUSB238A (QFN-16): 1 D+ 2 D- 3 CC1 4 CC2 5 VDD 6 DEBUG_N 7 EN_HVDCP 8 ADDR 9 SNK_VSET 10 SNK_ISET 11 INT_N 12 EN_N 13 FAULT 14 FLGIN 15 GATE 16 VBUS 17 EP
    husb = {"1": "", "2": "", "3": "CC1", "4": "CC2", "5": "PD_VDD", "6": "PD_DBG", "7": "PD_HVDCP", "8": "", "9": "PD_VSET", "10": "PD_ISET", "11": "", "12": "GND",
            "13": "PD_FAULT", "14": "GND", "15": "", "16": "VBUS", "17": "GND"}
    d.add("U_PD", "QFN16_PD", "HUSB238A-BB001", husb, (52, 42), 0, mpn="Hynetek HUSB238A-BB001-QN16R", lcsc="C24833806", desc="USB-C PD sink: asks the charger for 15 V / 3 A")
    d.row([("C", "1u", "PD_VDD", "GND"), ("R", "0R", "3V3", "PD_VDD"), ("R", "900k", "PD_DBG", "GND"), ("R", "900k", "PD_HVDCP", "GND"), ("R", "11k", "PD_VSET", "GND"), ("R", "21k", "PD_ISET", "GND")], 44, 48)
    n("HUSB238A in GPIO (stand-alone) mode: ADDR floating, SNK_VSET 11k = 15 V, SNK_ISET 21k = 3 A, EN_N and FLGIN grounded. It runs from VBUS when the board is off, from 3V3 when on. D+/D- and GATE unused; its FAULT output goes to the expander.")
    # BQ25798 (VQFN-29): 1 STAT 2-3 VBUS 4 BTST1 5 REGN 6 D+ 7 D- 8 VAC2 9 VAC1 10 ACDRV2 11 ACDRV1 12 QON 13 CE 14 SCL 15 SDA 16 TS 17 ILIM_HIZ 18 BATP
    #                     19 BTST2 20 PROG 21 INT 22-23 BAT 24 SDRV 25 SYS 26 SW2 27 GND 28 SW1 29 PMID      (power pins 25-29 along the top edge)
    cx, cy = 120, 44
    bq = {"1": "CHG_STAT", "2": "VBUS", "3": "VBUS", "4": "BST1", "5": "REGN", "6": "USB_DP", "7": "USB_DM", "8": "VBUS", "9": "VBUS", "10": "GND", "11": "GND",
          "12": "CHG_QON", "13": "GND", "14": "SCL", "15": "SDA", "16": "CHG_TS", "17": "CHG_ILIM", "18": "CHG_BATP", "19": "BST2", "20": "CHG_PROG", "21": "CHG_INT",
          "22": "VBAT", "23": "VBAT", "24": "CHG_SDRV", "25": "VSYS", "26": "SW2", "27": "GND", "28": "SW1", "29": "PMID"}
    d.add("U_CHG", "QFN29_BQ", "BQ25798RQMR", bq, (cx, cy), 0, mpn="TI BQ25798RQMR", lcsc="C2876593", desc="2S buck-boost charger with power path (NVDC), I2C 0x6B")
    d.add("L_CHG", "LPWR", "2.2uH", {"1": "SW1", "2": "SW2"}, (cx, cy - 9), 0, mpn="Sunlord MWSA0603S-2R2MT (2.2 uH, 10 A)", desc="Charger inductor")
    d.C("47n", "BST1", "SW1", (cx - 9.5, cy - 3), 0)
    d.C("47n", "BST2", "SW2", (cx + 3, cy + 6), 0)
    # PMID caps up the left toward the corner pin 29, VBUS caps against pins 2/3, REGN below, VBAT caps right of pins 22/23, SYS caps up the right
    d.col([("C", "10u", "PMID", "GND", {"fp": "C0805"}), ("C", "10u", "PMID", "GND", {"fp": "C0805"}), ("C", "10u", "PMID", "GND", {"fp": "C0805"}), ("C", "100n", "PMID", "GND")], cx - 8, cy - 12, dy=2.2, rot=180)
    d.col([("C", "10u", "VBUS", "GND", {"fp": "C0805"}), ("C", "10u", "VBUS", "GND", {"fp": "C0805"}), ("C", "100n", "VBUS", "GND")], cx - 6, cy, dy=2.2, rot=0)
    d.C("4.7u", "REGN", "GND", (cx - 9.5, cy + 3), 0)
    d.col([("C", "10u", "VSYS", "GND", {"fp": "C0805"}), ("C", "10u", "VSYS", "GND", {"fp": "C0805"}), ("C", "10u", "VSYS", "GND", {"fp": "C0805"}), ("C", "10u", "VSYS", "GND", {"fp": "C0805"}), ("C", "10u", "VSYS", "GND", {"fp": "C0805"}), ("C", "100n", "VSYS", "GND")], cx + 11, cy - 6, dy=2.2, rot=0)
    d.add("C_SYS", "CPOL", "100u 10V", {"1": "VSYS", "2": "GND"}, (cx + 11, cy + 10.5), 270, mpn="100uF 10V polymer 6.3x6", desc="VSYS bulk")
    d.C("10u", "VBAT", "GND", (cx + 7, cy), 0, fp="C0805")
    d.C("10u", "VBAT", "GND", (cx + 7, cy + 2.3), 0, fp="C0805")
    # straps: PROG 8.2k (2S, 750 kHz); ILIM_HIZ from REGN 10k/21k = 3.4 V -> 3 A; TS fixed 10k/15k (no pack thermistor); SDRV 1n; BATP 100R; STAT/INT pull-ups
    d.row([("R", "8.2k", "CHG_PROG", "GND"), ("R", "10k", "REGN", "CHG_ILIM"), ("R", "21k", "CHG_ILIM", "GND"), ("R", "10k", "REGN", "CHG_TS"), ("R", "15k", "CHG_TS", "GND"),
           ("C", "1n", "CHG_SDRV", "GND"), ("R", "100R", "VBAT_P", "CHG_BATP"), ("R", "10k", "CHG_STAT", "3V3"), ("R", "10k", "CHG_INT", "3V3")], cx - 24, cy + 24)
    d.add("TP_QON", "TP", "QON", {"1": "CHG_QON"}, (104, 27), desc="Test point: charger QON (ship-mode / reset)")
    n("BQ25798 straps: PROG 8.2k = 2S cells at 750 kHz (default VREG 8.40 V, ICHG 1 A, VSYSMIN 7 V); ILIM_HIZ 3.4 V = 3 A input limit; TS held at 0.6 x REGN (normal temperature) because the pack has its own BMS; VAC1/VAC2 tied to VBUS and ACDRV1/2 grounded (no external input FETs); CE grounded = charging enabled; QON only on a test pad. pedal-driver raises ICHG to 2 A over I2C after boot.")

    # ================================================================ POWER: battery path (fuse, reverse PFET, shunt, INA226) + power-button controller (left strip, right of knob 1)
    bx = 90
    d.add("F_BAT", "FUSE1812", "7.5A PTC", {"1": "BAT_RAW", "2": "BAT_F"}, (bx, 60), 90, mpn="SMD1812-750-12V (7.5 A hold PTC)", desc="Battery fuse")
    d.add("Q_REV", "SOIC8", "AO4407A", {"1": "VBAT_P", "2": "VBAT_P", "3": "VBAT_P", "4": "GND", "5": "BAT_F", "6": "BAT_F", "7": "BAT_F", "8": "BAT_F"}, (bx, 68), 0, mpn="Alpha&Omega AO4407A", lcsc="C16072", desc="Reverse-battery protection P-MOSFET")
    d.add("R_SH", "R2512", "5mR", {"1": "VBAT_P", "2": "VBAT"}, (bx, 76), 0, mpn="5 mOhm 1% 3 W 2512", desc="Battery current shunt")
    ina = {"1": "3V3", "2": "3V3", "3": "", "4": "SDA", "5": "SCL", "6": "3V3", "7": "GND", "8": "VBAT", "9": "VBAT", "10": "VBAT_P"}
    d.add("U_INA", "VSSOP10", "INA226AIDGSR", ina, (96, 82), 0, mpn="TI INA226AIDGSR", lcsc="C49851", desc="Battery volts / amps, I2C 0x45 (A0 = A1 = VS)")
    d.C("100n", "3V3", "GND", (99, 86))
    # LTC2954-1 (TSOT-8): 1 VIN 2 PB 3 ONT 4 GND 5 INT 6 EN 7 PDT 8 KILL   - EN is open-drain, pulled up to VSYS
    d.add("U_PWR", "TSOT23-8", "LTC2954CTS8-1", {"1": "VSYS", "2": "PB", "3": "", "4": "GND", "5": "PWR_INT", "6": "EN_PWR", "7": "PDT", "8": "PWR_KILL"}, (90, 84), 0, mpn="ADI LTC2954CTS8-1#TRPBF", lcsc="C683782", desc="Power button controller")
    d.row([("C", "1u", "VSYS", "GND"), ("C", "1u", "PDT", "GND"), ("R", "100k", "PWR_INT", "3V3"), ("R", "4.7k", "PWR_KILL", "3V3"), ("R", "100k", "EN_PWR", "VSYS")], 84, 89.5)
    n("Power button: tap = INT to GPIO 4 (Linux shuts down), Linux then drives GPIO 24 low = KILL = 5 V / 3.3 V off; holding the button ~7 s (1 uF on PDT) forces power off if Linux hangs. The charger keeps running either way.")

    # ================================================================ POWER: three TPS565208 bucks (under the screen, below the charger) and the analog LDO
    # TSOT-23-6: 1 GND 2 SW 3 VIN 4 VFB 5 EN 6 VBST.   VFB = 0.76 V.  5.14 V: 57.6k/10k, 3.3 V: 33.2k/10k
    def buck(ref, out, rtop, lval, at):
        x, y = at
        d.add(ref, "TSOT23-6", "TPS565208DDCR", {"1": "GND", "2": "SW_" + out, "3": "VSYS", "4": "FB_" + out, "5": "EN_PWR", "6": "BST_" + out}, (x, y), 0, mpn="TI TPS565208DDCR", lcsc="C2650336", desc="%s buck, 5 A" % out)
        d.add("L_" + out, "LPWR", lval, {"1": "SW_" + out, "2": out}, (x + 9, y + 1), 0, mpn="Sunlord MWSA0603S-%s (%s, 8 A)" % ("3R3MT" if lval == "3.3uH" else "2R2MT", lval), desc="%s inductor" % out)
        d.C("100n", "BST_" + out, "SW_" + out, (x + 3.5, y - 4))
        d.row([("R", rtop, out, "FB_" + out), ("R", "10k", "FB_" + out, "GND")], x - 3, y - 4)
        d.col([("C", "10u", "VSYS", "GND", {"fp": "C0805"}), ("C", "100n", "VSYS", "GND")], x - 5, y + 1.5, dy=2.2, rot=0)
        d.col([("C", "22u", out, "GND", {"fp": "C0805"}), ("C", "22u", out, "GND", {"fp": "C0805"})], x + 15.5, y - 1.5, dy=2.2, rot=0)
        d.add("C_" + out, "CPOL", "100u 10V", {"1": out, "2": "GND"}, (x + 9, y + 8.6), 0, mpn="100uF 10V polymer 6.3x6", desc="%s bulk" % out)
    buck("U_5V1", "5V1", "57.6k", "3.3uH", (112, 78))
    buck("U_5V2", "5V2", "57.6k", "3.3uH", (112, 94))
    buck("U_3V3", "3V3", "33.2k", "2.2uH", (112, 110))
    n("Bucks: TPS565208 (internally compensated, 5 A, 4.5-17 V in) x3 from VSYS. 5V1 = Pi + board logic, 5V2 = screens, USB-A, lights, fan, 3V3 = digital. 5.14 V (57.6k/10k) so the Pi sees ~5.05 V after the header.")
    # TLV75533 (SOT-23-5: 1 IN 2 GND 3 EN 4 NC 5 OUT) -> 3V3A analog
    d.add("U_LDO", "SOT23-5", "TLV75533PDBVR", {"1": "5V1", "2": "GND", "3": "5V1", "4": "", "5": "3V3A"}, (140, 70), 0, mpn="TI TLV75533PDBVR", lcsc="C404027", desc="3.3 V analog LDO (DACs, ADC, preamps)")
    d.row([("C", "1u", "5V1", "GND"), ("C", "1u", "3V3A", "GND"), ("C", "10u", "3V3A", "GND")], 134, 75)
    d.L("FB 60R", "5V1", "5VA", (146, 71), 0, mpn="Murata BLM21PG600SN1D", desc="Ferrite bead 60R@100MHz 3.5 A")
    d.C("10u", "5VA", "GND", (146, 74.5))
    for i, (name, net) in enumerate((("VSYS", "VSYS"), ("5V1", "5V1"), ("5V2", "5V2"), ("3V3", "3V3"), ("3V3A", "3V3A"), ("VBAT", "VBAT_P"), ("GND", "GND"))):
        d.add("TP_" + name, "TP", name, {"1": net}, (84 + 3 * i, 166), desc="Test point " + name)

    # ================================================================ AUDIO: three PCM5102A line DACs (under the screen, close to the output jacks)
    # PCM5102A (TSSOP-20): 1 CPVDD 2 CAPP 3 CPGND 4 CAPM 5 VNEG 6 OUTL 7 OUTR 8 AVDD 9 AGND 10 DEMP 11 FLT 12 SCK 13 BCK 14 DIN 15 LRCK 16 FMT 17 XSMT 18 LDOO 19 DGND 20 DVDD
    def dac(k, at, bck, lrck, din, xsmt, outl, outr):
        x, y = at
        pcm5 = {"1": "3V3A", "2": "CAPP%d" % k, "3": "GND", "4": "CAPM%d" % k, "5": "VNEG%d" % k, "6": "DAC%d_L" % k, "7": "DAC%d_R" % k, "8": "3V3A", "9": "GND", "10": "GND", "11": "GND",
                "12": "GND", "13": bck, "14": din, "15": lrck, "16": "GND", "17": xsmt, "18": "LDOO%d" % k, "19": "GND", "20": "3V3"}
        d.add("U_DAC%d" % k, "TSSOP20", "PCM5102APWR", pcm5, (x, y), 0, mpn="TI PCM5102APWR", lcsc="C107671", desc="DAC %d (outputs %d-%d)" % (k, 2 * k - 1, 2 * k))
        d.row([("C", "2.2u", "CAPP%d" % k, "CAPM%d" % k), ("C", "2.2u", "VNEG%d" % k, "GND"), ("C", "2.2u", "LDOO%d" % k, "GND"), ("C", "100n", "3V3A", "GND"), ("C", "10u", "3V3A", "GND"), ("C", "100n", "3V3", "GND")], x - 8, y - 6.5)
        for ch, net, out, yy in (("L", "DAC%d_L" % k, outl, y + 6), ("R", "DAC%d_R" % k, outr, y + 8.8)):
            d.R("470R", net, "F%d_%s" % (k, ch), (x - 7, yy))
            d.C("2.2n", "F%d_%s" % (k, ch), "GND", (x - 4, yy))
            d.R("100R", "F%d_%s" % (k, ch), out, (x - 1, yy))
    dac(1, (152, 42), "I2S_BCK", "I2S_LRCK", "I2S_DOUT", "DAC_XSMT", "OUT1", "OUT2")
    d.R("100k", "DAC_XSMT", "3V3", (144, 55), 0)
    dac(2, (196, 42), "BCK2", "LRCK2", "DIN2", "XSMT2", "OUT3", "OUT4")
    dac(3, (242, 42), "BCK3", "LRCK3", "DIN3", "XSMT3", "OUT5", "OUT6")
    n("DAC 1 hangs on the Pi's I2S (clocks from the PCM1808). DACs 2 and 3 are fed I2S by their own PCM2706C USB bridges, so Linux sees three stereo cards: the HAT card and two USB cards. All six outputs are the same PCM5102A line stage (2.1 Vrms, +8.7 dBu).")

    # PCM2706C x2 (TQFP-32), self-powered, I2S out: 1 PGND 2 VCCP 3 HOST 4 FUNC3 5 FUNC0(LRCK) 6-8 HID 9 FSEL 10 TEST 11 SSPND 12 XTI 13 XTO 14 CK 15 DT 16 PSEL
    #                                              17 DOUT 18 FUNC2(SCKO) 19 FUNC1(BCK) 20 DGND 21 VDD 22 D- 23 D+ 24 VBUS 25 ZGND 26 AGNDL 27 VCCL 28 VOUTL 29 VOUTR 30 VCCR 31 AGNDR 32 VCOM
    def usb_bridge(k, at, dm, dp):
        x, y = at
        pcm27 = {"1": "GND", "2": "3V3A", "3": "3V3", "4": "GND", "5": "LRCK%d" % k, "6": "GND", "7": "GND", "8": "GND", "9": "GND", "10": "3V3", "11": "XSMT%d" % k, "12": "XTI%d" % k, "13": "XTO%d" % k,
                 "14": "", "15": "ROMDT%d" % k, "16": "GND", "17": "DIN%d" % k, "18": "", "19": "BCK%d" % k, "20": "GND", "21": "3V3", "22": dm, "23": dp, "24": "3V3", "25": "GND", "26": "GND",
                 "27": "3V3A", "28": "", "29": "", "30": "3V3A", "31": "GND", "32": "VCOM%d" % k}
        d.add("U_USB%d" % k, "TQFP32", "PCM2706CPJTR", pcm27, (x, y), 0, mpn="TI PCM2706CPJTR", lcsc="C2651268", desc="USB audio bridge %d (feeds DAC %d over I2S)" % (k, k))
        d.add("Y_USB%d" % k, "XTAL3225", "12MHz", {"1": "XTI%d" % k, "2": "GND", "3": "XTO%d" % k, "4": "GND"}, (x - 8, y + 5), 0, mpn="12 MHz 3225 crystal 20 pF", desc="USB bridge crystal")
        d.row([("C", "22p", "XTI%d" % k, "GND"), ("C", "22p", "XTO%d" % k, "GND"), ("R", "10k", "ROMDT%d" % k, "3V3"), ("C", "10u", "VCOM%d" % k, "GND")], x - 9, y + 9)
        d.row([("C", "100n", "3V3", "GND"), ("C", "10u", "3V3", "GND"), ("C", "100n", "3V3A", "GND"), ("C", "10u", "3V3A", "GND"), ("C", "100n", "3V3A", "GND")], x - 7, y - 7.5)
        d.R("100k", "XSMT%d" % k, "3V3", (x + 8, y + 9), 0)
    usb_bridge(2, (196, 90), "HUB_DM1", "HUB_DP1")
    usb_bridge(3, (250, 90), "HUB_DM2", "HUB_DP2")
    n("PCM2706C: PSEL low = self-powered, HOST high (a USB host is always present through the on-board hub), VBUS pin to 3.3 V as the datasheet asks for self-powered use, FSEL low = I2S out, TEST high, HID pins low, FUNC3 (unused I2S input) low; SSPND mutes its DAC (XSMT) while the host is suspended.")

    # USB hub SL2.1A (SOP-16): 1 DM4 2 DP4 3 DM3 4 DP3 5 DM2 6 DP2 7 DM1 8 DP1 9 UDM 10 UDP 11 VCC5 12 VSS 13 VDD33 14 VDD18 15 XOUT 16 XIN
    hx, hy = 152, 86
    d.add("U_HUB", "SOP16_HUB", "SL2.1A", {"1": "BAR_DM", "2": "BAR_DP", "3": "USBA_DM", "4": "USBA_DP", "5": "HUB_DM2", "6": "HUB_DP2", "7": "HUB_DM1", "8": "HUB_DP1",
                                          "9": "UP_DM", "10": "UP_DP", "11": "5V1", "12": "GND", "13": "HUB_33", "14": "HUB_18", "15": "HUB_XO", "16": "HUB_XI"}, (hx, hy), 0, mpn="CoreChips SL2.1A", lcsc="C6798314", desc="USB 2.0 hub: Pi -> 2 audio bridges, USB-A, bar screen touch")
    d.add("Y_HUB", "XTAL3225", "12MHz", {"1": "HUB_XI", "2": "GND", "3": "HUB_XO", "4": "GND"}, Y_HUB_AT, 0, mpn="12 MHz 3225 crystal 20 pF", desc="Hub crystal")
    d.row([("C", "4.7u", "HUB_33", "GND"), ("C", "4.7u", "HUB_18", "GND"), ("C", "10u", "5V1", "GND"), ("C", "100n", "5V1", "GND")], hx - 7, hy - 7)
    n("SL2.1A hub: single 5 V supply with internal 3.3 V / 1.8 V LDOs (4.7 uF each), 12 MHz crystal (the datasheet says no load capacitors, none fitted). Upstream to a Pi USB port by a short JST-PH -> USB-A cable; port 3 is the back-panel USB-A, port 4 feeds the bar screen's touch and power.")

    # instrument inputs A and B: OPA1678 (dual) -> PCM1808 (master, 256fs, 12.288 MHz oscillator)
    px, py = 120, 132
    pcm18 = {"1": "ADC_VREF", "2": "GND", "3": "5VA", "4": "3V3", "5": "GND", "6": "ADC_SCK", "7": "I2S_LRCK", "8": "I2S_BCK", "9": "I2S_DIN", "10": "3V3", "11": "3V3", "12": "GND", "13": "ADC_INL", "14": "ADC_INR"}
    d.add("U_ADC", "TSSOP14", "PCM1808PWR", pcm18, (px, py), 0, mpn="TI PCM1808PWR", lcsc="C55513", desc="Instrument ADC (A = left, B = right), I2S master 48 kHz")
    d.row([("C", "10u", "ADC_VREF", "GND"), ("C", "100n", "5VA", "GND"), ("C", "10u", "5VA", "GND"), ("C", "100n", "3V3", "GND")], px - 6, py - 6)
    d.add("X_ADC", "OSC3225", "12.288MHz", {"1": "3V3", "2": "GND", "3": "ADC_SCK", "4": "3V3"}, (px + 8, py - 6), 0, mpn="12.288 MHz 3.3 V CMOS oscillator 3225", desc="ADC master clock")
    d.C("100n", "3V3", "GND", (px + 12, py - 6))
    # OPA1678 (SOIC-8): 1 OUTA 2 -INA 3 +INA 4 V- 5 +INB 6 -INB 7 OUTB 8 V+   on 5VA, biased at 2.5 V; channel A = instrument A, B = instrument B
    ox, oy = 112, 148
    d.add("U_PRE", "SOIC8", "OPA1678IDR", {"1": "PRE_A", "2": "PRE_AN", "3": "PRE_AP", "4": "GND", "5": "PRE_BP", "6": "PRE_BN", "7": "PRE_B", "8": "5VA"}, (ox, oy), 0, mpn="TI OPA1678IDR", lcsc="C192421", desc="Instrument preamps A and B")
    d.row([("R", "100k", "5VA", "VBIAS"), ("R", "100k", "VBIAS", "GND"), ("C", "10u", "VBIAS", "GND"), ("C", "100n", "5VA", "GND")], ox - 7, oy - 6)
    for ch, inp, det, pre, pren, prep, adc, yy in (("A", "INST_A", "INST_DET_A", "PRE_A", "PRE_AN", "PRE_AP", "ADC_INL", oy + 6), ("B", "INST_B", "INST_DET_B", "PRE_B", "PRE_BN", "PRE_BP", "ADC_INR", oy + 9.2)):
        d.row([("C", "100n", inp, "IN_AC_" + ch), ("R", "1M", "IN_AC_" + ch, "VBIAS"), ("R", "100R", "IN_AC_" + ch, prep), ("R", "10k", pren, "VBIAS"), ("R", "30k", pre, pren),
               ("C", "100p", pre, pren), ("R", "4.7k", pre, "ADC_RC_" + ch), ("C", "1n", "ADC_RC_" + ch, "GND"), ("C", "1u", "ADC_RC_" + ch, adc)], ox - 12, yy)
        d.add("JP_GAIN_" + ch, "SJ", "GAIN %s 0dB" % ch, {"1": pre, "2": pren}, (ox + 18, yy), 0, desc="Close = 0 dB for active pickups / keyboards; open = +12 dB")
        d.C("100n", det, "GND", (ox + 22.5, yy))
        d.D("PESD5V0S1UB", "GND", det, (ox + 25.5, yy), 90, fp="SOD523", mpn="Nexperia PESD5V0S1UB")
        d.R("10k", det, "3V3", (ox + 28.5, yy))
    n("Instrument inputs: 1 M to a 2.5 V bias, x4 (+12 dB) non-inverting stage, 4.7k/1n anti-alias, into the PCM1808. The jack's TN contact grounds the tip when nothing is plugged in; the ring is a plug-detect to the expander (low = plugged).")

    # headphones: the Pi's own PWM audio (GPIO 12/13 via dtoverlay=audremap,pins_12_13) -> 2-pole RC -> TPA6130A2 (I2C 0x60)
    tx, ty = 182, 124
    tpa = {"1": "HP_INL", "2": "HP_GL", "3": "GND", "4": "HP_GR", "5": "HP_INR", "6": "HP_SD", "7": "SDA", "8": "SCL", "9": "GND", "10": "GND", "11": "HP_R", "12": "3V3", "13": "GND",
           "14": "HP_L", "15": "CPVSS", "16": "CPVSS", "17": "CPN", "18": "CPP", "19": "GND", "20": "3V3", "21": "GND"}
    d.add("U_HP", "QFN20_HP", "TPA6130A2RTJR", tpa, (tx, ty), 0, mpn="TI TPA6130A2RTJR", lcsc="C130046", desc="Headphone amp, I2C 0x60 (volume in software)")
    d.row([("C", "1u", "CPP", "CPN"), ("C", "1u", "CPVSS", "GND"), ("C", "1u", "3V3", "GND"), ("C", "1u", "3V3", "GND"), ("R", "10k", "HP_SD", "3V3"), ("C", "1u", "HP_GL", "GND"), ("C", "1u", "HP_GR", "GND")], tx - 9, ty - 6.5)
    for ch, pwm, hin, yy in (("L", "PWM_L", "HP_INL", ty + 6), ("R", "PWM_R", "HP_INR", ty + 9.2)):
        d.row([("R", "270R", pwm, "PWF1_" + ch), ("C", "33n", "PWF1_" + ch, "GND"), ("R", "150R", "PWF1_" + ch, "PWF2_" + ch), ("C", "10n", "PWF2_" + ch, "GND"), ("C", "1u", "PWF2_" + ch, hin)], tx - 9, yy)
    n("Headphones = the Pi's own audio device (PWM remapped to GPIO 12/13), filtered and amplified by the TPA6130A2; the app's Output routing sends any bus to it. HP_SD (shutdown) is driven by PCA9685 channel 11 so the amp stays off until the driver is up (no thump).")
    # MIDI: 6N138 (SMD-8): 1 NC 2 anode 3 cathode 4 NC 5 GND 6 Vo 7 Vb 8 Vcc
    mdx, mdy = 275, 56
    d.add("U_MIDI", "SMD8_OPTO", "6N138S", {"1": "", "2": "MIDI_A", "3": "MIDI_K", "4": "", "5": "GND", "6": "MIDI_RX", "7": "", "8": "5V1"}, (mdx, mdy), 0, mpn="Lite-On 6N138S-TA1-L (SMD-8, 2.54 mm pitch)", lcsc="C22451885", desc="MIDI in optocoupler")
    d.row([("R", "220R", "MIDI_IN_T", "MIDI_A"), ("R", "2.2k", "MIDI_RX", "3V3"), ("C", "100n", "5V1", "GND"), ("R", "10R", "MIDI_TX", "MIDI_OUT_R"), ("R", "33R", "3V3", "MIDI_OUT_T"), ("R", "0R", "MIDI_K", "MIDI_IN_R")], mdx - 8, mdy + 8)
    d.D("1N4148W", "MIDI_K", "MIDI_A", (mdx - 8, mdy), 90, fp="SOD123", mpn="1N4148W")
    n("MIDI: 3.5 mm TRS type A. Out drives 3.3 V through 33R (tip) / 10R (ring) as the MIDI 3.3 V spec says; in is the classic 6N138 with a 2.2k pull-up to 3.3 V on UART0 RX.")
    # ADS1115 (VSSOP-10): 1 ADDR 2 ALERT 3 GND 4 AIN0 5 AIN1 6 AIN2 7 AIN3 8 VDD 9 SDA 10 SCL   address 0x48
    d.add("U_FADC", "VSSOP10", "ADS1115IDGSR", {"1": "GND", "2": "", "3": "GND", "4": "FAD_A_ADC", "5": "FAD_B_ADC", "6": "VBUS_SENSE", "7": "", "8": "3V3A", "9": "SDA", "10": "SCL"}, (272, 40), 0, mpn="TI ADS1115IDGSR", lcsc="C37593", desc="Fader ADC (16-bit), I2C 0x48; AIN2 = USB input volts")
    d.row([("C", "100n", "3V3A", "GND"), ("R", "100k", "VBUS", "VBUS_SENSE"), ("R", "15k", "VBUS_SENSE", "GND"), ("C", "100n", "VBUS_SENSE", "GND")], 264, 34)

    # ================================================================ CONTROLS: footswitches (10) with lights and label screens
    def oled(ref, at, desc, links="left"):
        x, y = at
        d.add(ref, "OLED", "OLED 0.91in", {"1": ref + "_P1", "2": ref + "_P2", "3": "SC_" + ref, "4": "SD_" + ref}, (x, y), 0, mpn="0.91 inch 128x32 I2C OLED module, SSD1306, 4-pin (GND VCC SCL SDA)", desc=desc)
        # power-pin order links beside the socket: fit A for GND-VCC-SCL-SDA modules (default), fit B instead for VCC-GND-SCL-SDA modules
        lx = x - 4.5 if links == "left" else x + 39.5
        d.col([("R", "0R", ref + "_P1", "GND", {"desc": "A: fit for GND-VCC modules"}), ("R", "0R", ref + "_P2", "3V3", {"desc": "A: fit for GND-VCC modules"}),
               ("R", "0R", ref + "_P1", "3V3", {"dnp": True, "desc": "B: fit for VCC-GND modules"}), ("R", "0R", ref + "_P2", "GND", {"dnp": True, "desc": "B: fit for VCC-GND modules"}),
               ("C", "100n", "3V3", "GND")], lx, y - 3.4, dy=1.7, rot=0)

    def footswitch(k, x, y, gpio_net, led_net, oled_y):
        d.add("SW_FS%d" % k, "FSW", "FOOTSWITCH %d" % k, {"1": "FS%d" % k, "2": "GND"}, (x, y), 0, mpn="SPST momentary soft-touch footswitch, PCB pins (ST P-H-ST8105 / Tayda SF13P-0102-23.5R-M12)", desc="Footswitch %d" % k)
        d.R("100R", "FS%d" % k, gpio_net, (x - 7, y + 10.5))
        d.C("100n", "FS%d" % k, "GND", (x - 4, y + 10.5))
        d.D("PESD5V0S1UB", "GND", "FS%d" % k, (x - 1, y + 10.5), 90, fp="SOD523", mpn="Nexperia PESD5V0S1UB")
        d.add("LED_FS%d" % k, "LED5", "LED 5mm", {"1": "LEDK%d" % k, "2": "5V2"}, (x + 14, y - 9), 90, mpn="5 mm yellow LED (XINGLIGHT XL-504UYC), on a 10 mm LED spacer", lcsc="C2895487", desc="Footswitch %d light" % k)
        d.R("330R", "LEDK%d" % k, led_net, (x + 8, y + 10.5))
        oled("OLED_FS%d" % k, (x - 16.5, oled_y), "Label screen, footswitch %d" % k)
    for i in range(8):
        footswitch(i + 1, FSW_X[i], FSW_Y, "GPIO_FS%d" % (i + 1), "LED%d" % (i + 1), 236)
    footswitch(9, FSW_X[0], FSW9_Y, "GPIO_FS9", "LED9", 182)
    footswitch(10, FSW_X[7], FSW9_Y, "GPIO_FS10", "LED10", 182)

    # ================================================================ CONTROLS: six click-knobs (PEC11R encoders) + two faders, with label screens
    # Encoder pads (EasyEDA PEC11R): 1 A, 2 C, 3 B, 4 S1, 5 S2, 7/8 mounting.   Side strips: fader - one knob - two knobs - screen.
    knobs = {1: (52, 84), 2: (80, 52), 3: (80, 120), 4: (W - 80, 52), 5: (W - 80, 120), 6: (W - 52, 84)}
    for k, (x, y) in knobs.items():
        d.add("ENC%d" % k, "ENC", "KNOB %d" % k, {"1": "ENC%dA" % k, "2": "GND", "3": "ENC%dB" % k, "4": "ENC%dS" % k, "5": "GND", "7": "GND", "8": "GND"}, (x, y), 0, mpn="Bourns PEC11R-4220F-S0024 (24 detents, push switch, 20 mm shaft)", lcsc="C143797", desc="Knob %d (click-knob)" % k)
        side = 1 if x < W / 2 else -1
        d.col([("R", "10k", "ENC%dA" % k, "3V3"), ("C", "10n", "ENC%dA" % k, "GND"), ("R", "10k", "ENC%dB" % k, "3V3"), ("C", "10n", "ENC%dB" % k, "GND"), ("R", "10k", "ENC%dS" % k, "3V3"), ("C", "10n", "ENC%dS" % k, "GND")], x - side * 10.5, y - 8.5, dy=3.05)
        oled("OLED_K%d" % k, (x - 16.5, y - 17 if k in (1, 6) else y - 20), "Label screen, knob %d" % k, links="right" if k == 1 else "left")
    n("Knobs are Bourns PEC11R-4220F-S0024 encoders (24 detents, push switch, 20 mm flatted shaft); the top plate has a 7.5 mm clearance hole, no nut (the plate is 15.5 mm up, past the 7 mm bushing). 10k pull-ups + 10n on every A/B/switch line into the MCP23017s.")
    # faders: Bourns PTA6043 (60 mm travel, 15 mm lever); pads 1/2 at one end (1 = CCW end, 2 = wiper), 3 at the other end, 4-7 mounting
    for ref, x, name, w in (("RV_A", FSW_X[0], "Fader A", "FAD_A_W"), ("RV_B", FSW_X[7], "Fader B", "FAD_B_W")):
        d.add(ref, "FADER", "10k lin slide", {"1": "GND", "2": w, "3": "3V3A", "4": "GND", "5": "GND", "6": "GND", "7": "GND"}, (x, 83.5), 90, mpn="Bourns PTA6043-2015DPB103", lcsc="C17555413", desc=name + " (expression)")
        side = 1 if x < W / 2 else -1
        d.R("1k", w, w[:-2] + "_ADC", (x + side * 8, 124), 90)
        d.C("100n", w[:-2] + "_ADC", "GND", (x + side * 8, 128), 90)
        oled("OLED_" + ref[-1], (x - 16.5, 30), "Label screen, " + name.lower())

    # ================================================================ EXPANDERS, LIGHTS, LABEL-SCREEN MUXES, EEPROM, FAN
    # MCP23017 (SSOP-28): 1-8 GPB0-7, 9 VDD, 10 VSS, 12 SCL, 13 SDA, 15-17 A0-A2, 18 RESET, 19 INTB, 20 INTA, 21-28 GPA0-7
    def expander(ref, addr_bits, at, gpa, gpb, inta, desc):
        x, y = at
        m = {"9": "3V3", "10": "GND", "11": "", "12": "SCL", "13": "SDA", "14": "", "15": "3V3" if addr_bits & 1 else "GND", "16": "3V3" if addr_bits & 2 else "GND", "17": "3V3" if addr_bits & 4 else "GND", "18": "EXP_RST", "19": "", "20": inta}
        for i in range(8):
            m[str(21 + i)] = gpa[i]
            m[str(1 + i)] = gpb[i]
        d.add(ref, "SSOP28", "MCP23017-E/SS", m, (x, y), 0, mpn="Microchip MCP23017-E/SS", lcsc="C506653", desc=desc)
        d.C("100n", "3V3", "GND", (x - 5, y - 8))
    expander("U_EXP1", 0, (270, 88), ["ENC1A", "ENC1B", "ENC2A", "ENC2B", "ENC3A", "ENC3B", "ENC4A", "ENC4B"], ["ENC5A", "ENC5B", "ENC6A", "ENC6B", "ENC1S", "ENC2S", "ENC3S", "ENC4S"], "EXP1_INT", "Expander 1 (0x20): knob encoders")
    expander("U_EXP2", 1, (284, 88), ["ENC5S", "ENC6S", "EXTA_T", "EXTA_R", "EXTB_T", "EXTB_R", "INST_DET_A", "INST_DET_B"], ["CHG_STAT", "PD_FAULT", "CHG_INT", "SPARE1", "SPARE2", "SPARE3", "SPARE4", "SPARE5"], "EXP2_INT", "Expander 2 (0x21): knob clicks, external footswitches, plug detects, charger status")
    d.R("10k", "EXP_RST", "3V3", (272, 80), 0)
    # (rev B.1: the five spare-input test points that used to sit above the expanders are gone - their fan of tracks
    #  walled in the expander's charger-status pins; the spare inputs stay on U_EXP2 pins 4-8 for a later revision)
    # external footswitch inputs: pull-up, filter, ESD
    for i, net in enumerate(("EXTA_T", "EXTA_R", "EXTB_T", "EXTB_R")):
        d.R("10k", net, "3V3", (240 + 3.2 * i, 102), 90)
        d.C("100n", net, "GND", (240 + 3.2 * i, 106), 90)
        d.D("PESD5V0S1UB", "GND", net, (240 + 3.2 * i, 110), 90, fp="SOD523", mpn="Nexperia PESD5V0S1UB")
    # PCA9685 (TSSOP-28): 1-5 A0-A4, 6-13 LED0-7, 14 GND, 15-22 LED8-15, 23 EXTCLK, 24 A5, 25 OE, 26 SCL, 27 SDA, 28 VDD   address 0x41 (A0 high), open-drain sinks
    pca = {"1": "3V3", "2": "GND", "3": "GND", "4": "GND", "5": "GND", "14": "GND", "23": "GND", "24": "GND", "25": "GND", "26": "SCL", "27": "SDA", "28": "3V3"}
    for i in range(10):
        pca[str(6 + i if i < 8 else 15 + i - 8)] = "LED%d" % (i + 1)
    pca["17"] = "LED_ST"          # channel 10: status LED
    pca["18"] = "HP_SD"           # channel 11: headphone amp enable
    d.add("U_LED", "TSSOP28", "PCA9685PW", pca, (252, 150), 0, mpn="NXP PCA9685PW,118", lcsc="C2678753", desc="Footswitch lights + status + headphone enable, I2C 0x41")
    d.C("100n", "3V3", "GND", (246, 142))
    d.C("10u", "3V3", "GND", (249, 142))
    d.add("D_ST", "LED0603", "GREEN", {"1": "LED_ST_K", "2": "3V3"}, (262, 142), 0, mpn="0603 green LED (KENTO KT-0603G)", lcsc="C12624", desc="Status LED (driver running)")
    d.R("330R", "LED_ST_K", "LED_ST", (265.5, 142), 0)
    # TCA9548A x3 (TSSOP-24): 1 A0 2 A1 3 RESET 4 SD0 5 SC0 ... 11 SC3 12 GND 13 SD4 14 SC4 ... 20 SC7 21 A2 22 SCL 23 SDA 24 VCC   addresses 0x70, 0x71, 0x72
    OLEDS = (["OLED_FS%d" % k for k in range(1, 11)] + ["OLED_K%d" % k for k in range(1, 7)] + ["OLED_A", "OLED_B"])
    assert len(OLEDS) == 18
    for m in range(3):
        x, y = 160 + 30 * m, 150
        chans = OLEDS[8 * m:8 * m + 8]
        t = {"1": "3V3" if m & 1 else "GND", "2": "3V3" if m & 2 else "GND", "3": "MUX_RST", "12": "GND", "21": "GND", "22": "SCL", "23": "SDA", "24": "3V3"}
        for c in range(8):
            if c < len(chans):
                t[str(4 + 2 * c if c < 4 else 13 + 2 * (c - 4))] = "SD_" + chans[c]
                t[str(5 + 2 * c if c < 4 else 14 + 2 * (c - 4))] = "SC_" + chans[c]
        d.add("U_MUX%d" % (m + 1), "TSSOP24", "TCA9548APWR", t, (x, y), 0, mpn="TI TCA9548APWR", lcsc="C130026", desc="I2C mux %d (0x7%d) for label screens %s" % (m + 1, m, ", ".join(c.replace("OLED_", "") for c in chans)))
        d.C("100n", "3V3", "GND", (x - 6, y - 8))
        for c, ch in enumerate(chans):
            d.R("4.7k", "SD_" + ch, "3V3", (x - 10 + 2.6 * c, y + 8), 90)
            d.R("4.7k", "SC_" + ch, "3V3", (x - 10 + 2.6 * c, y + 12), 90)
    d.R("10k", "MUX_RST", "3V3", (166, 142), 0)
    n("Label screens: 18 x 0.91-inch 128x32 I2C OLED modules in 4-pin sockets behind 3 TCA9548A muxes (0x70-0x72), one module per mux channel, 4.7k pull-ups per channel, powered from 3V3. Modules come in two pin orders: GND-VCC-SCL-SDA (0R links 'A' fitted) and VCC-GND-SCL-SDA (move the two 0R links to 'B').")
    # HAT ID EEPROM CAT24C32 (SOIC-8): 1-3 A0-A2, 4 VSS, 5 SDA, 6 SCL, 7 WP, 8 VCC
    d.add("U_EEP", "SOIC8", "CAT24C32WI-GT3", {"1": "GND", "2": "GND", "3": "GND", "4": "GND", "5": "ID_SD", "6": "ID_SC", "7": "EEP_WP", "8": "3V3"}, (282, 150), 0, mpn="onsemi CAT24C32WI-GT3", lcsc="C81193", desc="HAT ID EEPROM (the board announces itself to the Pi)")
    d.C("100n", "3V3", "GND", (277, 144))
    d.add("JP_WP", "SJ", "EEPROM WP", {"1": "EEP_WP", "2": "3V3"}, (286.5, 144), 0, desc="Close to write-protect the HAT EEPROM")
    d.R("10k", "EEP_WP", "GND", (282, 156), 0)
    # fan switch AO3400 (SOT-23: 1 G 2 S 3 D) + flyback
    d.add("Q_FAN", "SOT23", "AO3400A", {"1": "FAN_G", "2": "GND", "3": "FAN_N"}, (255, 128), 0, mpn="Alpha&Omega AO3400A", lcsc="C20917", desc="Fan switch")
    d.R("100R", "FAN_CTL", "FAN_G", (249, 125), 90)
    d.R("10k", "FAN_G", "GND", (249, 130), 90)
    d.D("1N4148W", "FAN_N", "5V2", (259, 123), 0, fp="SOD123", mpn="1N4148W")

    # ================================================================ BACK-SIDE CONNECTORS (internal cables)
    d.add("J_BAT", "VH2", "JST VH 2", {"1": "GND", "2": "BAT_RAW"}, (92, 50), 0, side="B", mpn="JST B2P-VH(LF)(SN)", desc="2S battery pack (with its own BMS), 10 A connector")
    d.add("J_FAN", "PH2", "JST PH 2", {"1": "FAN_N", "2": "5V2"}, (120, 165), 0, side="B", mpn="JST B2B-PH-K-S", desc="5 V fan")
    d.add("J_DISP", "PH2", "JST PH 2", {"1": "GND", "2": "5V2"}, (135, 165), 0, side="B", mpn="JST B2B-PH-K-S", desc="7-inch Touch Display 2 power")
    d.add("J_USB_UP", "PH4", "JST PH 4", {"1": "", "2": "UP_DM", "3": "UP_DP", "4": "GND"}, (250, 165), 0, side="B", mpn="JST B4B-PH-K-S", desc="Hub upstream: short cable to a Pi USB-A port (pin 1 not connected)")
    d.add("J_USB_BAR", "PH4", "JST PH 4", {"1": "5V2", "2": "BAR_DM", "3": "BAR_DP", "4": "GND"}, (270, 165), 0, side="B", mpn="JST B4B-PH-K-S", desc="Bar screen: cable to its micro-USB (touch + power)")
    d.add("D_BAR", "SOT23-6", "USBLC6-2SC6", {"1": "BAR_DP", "2": "GND", "3": "BAR_DM", "4": "BAR_DM", "5": "5V2", "6": "BAR_DP"}, (270, 158), 0, side="B", mpn="ST USBLC6-2SC6", desc="Bar screen USB ESD")
    n("Cables inside the box: Pi USB-A -> J_USB_UP (JST-PH 4); micro-HDMI 0 on the Pi -> bar screen HDMI; J_USB_BAR -> bar screen micro-USB (touch + 5 V); J_DISP -> Touch Display 2 power; display ribbon through the slot to the Pi's DSI; J_BAT -> 2S pack.")

    # ================================================================ MOUNTING HOLES (M3 to the top plate / standoffs); Pi holes are added by build.py from the header
    holes = [(5, 5), (W - 5, 5), (5, H - 5), (W - 5, H - 5), (75, 5), (W - 75, 5), (5, 150), (W - 5, 150), (92, 150), (W - 92, 150)]
    holes += [((FSW_X[i] + FSW_X[i + 1]) / 2, 270) for i in range(7)]
    for (x, y) in holes:
        d.add("H?", "HOLE_M3", "M3", {}, (x, y), desc="Standoff to the top plate")
    return d


# ---------------------------------------------------------------- hand-routed power copper (build.py lays these before the autorouter runs)
# (net, layer, width mm, [points])   layer: "F" or "B"
TRUNKS = [
    # USB-C VBUS pads -> vias under the connector -> back-side trunk -> charger input caps (3 A)
    ("VBUS", "F", 0.5, [(27.55, 7.7), (27.55, 10.5)]), ("VBUS", "F", 0.5, [(32.45, 7.7), (32.45, 10.5)]),
    ("VBUS", "B", 2.0, [(27.55, 10.5), (36, 10.5), (36, 38), (106, 38)]),
    ("VBUS", "F", 0.6, [(106, 38), (106, 44), (113.1, 44)]),
    # battery shunt -> charger BAT pins / caps (5 A), all on the front
    ("VBAT", "F", 1.5, [(92.96, 76), (99.5, 76), (99.5, 71), (125.5, 71), (125.5, 43.3)]),
    ("VBAT", "F", 0.2, [(122.2, 42.85), (125.0, 42.85)]), ("VBAT", "F", 0.2, [(122.2, 43.18), (125.0, 43.18)]),
    # battery connector -> fuse (5 A)
    ("BAT_RAW", "F", 2.0, [(95.96, 50), (95.96, 62.14), (91, 62.14)]),
    # charger SYS output -> back-side trunk -> the three bucks (5 A)
    ("VSYS", "F", 1.0, [(130.2, 49), (130.2, 50.5), (128.8, 52), (128.8, 60), (130.5, 60)]),
    ("VSYS", "B", 2.0, [(130.5, 60), (104, 60), (104, 111.5)]),
    ("VSYS", "F", 0.8, [(104, 79.5), (106.1, 79.5)]), ("VSYS", "F", 0.8, [(104, 95.5), (106.1, 95.5)]), ("VSYS", "F", 0.8, [(104, 111.5), (106.1, 111.5)]),
    # 5V2 from its buck -> back-side trunk -> the 5V2 plane region at the bottom
    ("5V2", "F", 0.8, [(126.55, 94.7), (125.5, 96), (125.5, 97.8)]), ("5V2", "B", 1.5, [(125.5, 97.8), (141.5, 97.8), (141.5, 162)]),
    # BQ25798 top-edge power pins: SYS up-right to its caps, PMID up-left to its caps, SW1 / SW2 straight up then into the inductor
    ("VSYS", "F", 0.25, [(120.9, 41.9), (120.9, 41.1), (129.6, 41.1), (129.8, 42.0)]),
    ("PMID", "F", 0.25, [(119.1, 41.78), (119.1, 41.0), (114.6, 41.0), (114.6, 38.6), (113.1, 38.6)]),
    ("SW1", "F", 0.25, [(119.55, 41.78), (119.55, 38.6), (118.0, 36.75)]), ("SW2", "F", 0.25, [(120.45, 41.78), (120.45, 38.6), (122.0, 36.75)]),
]
VIAS = [  # (net, x, y, diameter, drill)
    ("VBUS", 27.55, 10.5, 0.8, 0.4), ("VBUS", 32.45, 10.5, 0.8, 0.4), ("VBUS", 106, 38, 0.8, 0.4),
    ("VSYS", 130.5, 60, 0.8, 0.4), ("VSYS", 104, 79.5, 0.8, 0.4), ("VSYS", 104, 95.5, 0.8, 0.4), ("VSYS", 104, 111.5, 0.8, 0.4),
    ("5V2", 125.5, 97.8, 0.8, 0.4), ("5V2", 141.5, 162, 0.8, 0.4),
]


if __name__ == "__main__":
    d = build()
    nets = d.nets()
    print(len(d.parts), "parts,", len(nets), "nets")
    singles = {k: v for k, v in nets.items() if len(v) == 1}
    print("single-pin nets:", sorted(singles))
    import collections
    print(collections.Counter(p["fp"] for p in d.parts).most_common(12))
