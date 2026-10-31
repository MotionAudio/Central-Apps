#!/usr/bin/env python3
"""Central Pedal - the Pi's sound set-up without a Pi: which cards make the combined output (pad-pedal-audio-config)
and where the native instrument plays when its output isn't there (instrument_host.fit_channel).

  python3 test_audio_routing.py
"""
import importlib.machinery
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

loader = importlib.machinery.SourceFileLoader("pad_pedal_audio_config", os.path.join(HERE, "pad-pedal-audio-config"))
spec = importlib.util.spec_from_loader(loader.name, loader)
cfgmod = importlib.util.module_from_spec(spec)
loader.exec_module(cfgmod)

passed = failed = 0


def check(label, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print("  ✓ " + label)
    except Exception as error:  # noqa: BLE001
        failed += 1
        print("  ✗ " + label + "\n      " + str(error))


JACK = ("alsa_output.platform-bcm2835_audio.stereo-fallback", "Built-in Audio Stereo", 2)
DAC = ("alsa_output.platform-soc_sound.stereo-fallback", "snd_rpi_hifiberry_dac", 2)
HDMI0 = ("alsa_output.platform-fef00700.hdmi.hdmi-stereo", "Built-in Audio Digital Stereo (HDMI)", 2)
HDMI1 = ("alsa_output.platform-fef05700.hdmi.hdmi-stereo", "Built-in Audio Digital Stereo (HDMI 2)", 2)
CARDS = [(0, "Headphones"), (1, "vc4hdmi0"), (2, "vc4hdmi1"), (3, "sndrpihifiberry")]


def t_jack_only():
    planned, pos = cfgmod.plan([JACK, HDMI0, HDMI1], {"hdmi": False})
    assert [p[0] for p in planned] == ["jack"] and pos == ["FL", "FR"], planned
    assert cfgmod.channel_names(planned, pos) == ["Headphone jack L", "Headphone jack R"]


def t_jack_dac():
    planned, pos = cfgmod.plan([HDMI0, DAC, JACK], {"hdmi": False})
    assert [p[0] for p in planned] == ["jack", "i2s"] and len(pos) == 4, planned


def t_waits_for_the_jack():
    # PipeWire makes the HDMI sinks first: stopping at two sinks planned without the jack (silence on it)
    calls = {"n": 0}
    seq = [[HDMI0, HDMI1], [HDMI0, HDMI1, DAC], [HDMI0, HDMI1, DAC, JACK]]

    def fake_sinks(env):
        i = min(calls["n"], len(seq) - 1)
        calls["n"] += 1
        return seq[i]
    old_s, old_c, old_sleep = cfgmod.pw_sinks, cfgmod.asound_cards, cfgmod.time.sleep
    cfgmod.pw_sinks, cfgmod.asound_cards, cfgmod.time.sleep = fake_sinks, (lambda: CARDS), (lambda s: None)
    os.environ["CC_AUDIO_NO_OWN"] = "1"   # (the old way: every card from WirePlumber)
    try:
        sinks = cfgmod.wait_for_sinks({}, {"hdmi": False}, timeout=5)
    finally:
        cfgmod.pw_sinks, cfgmod.asound_cards, cfgmod.time.sleep = old_s, old_c, old_sleep
        os.environ.pop("CC_AUDIO_NO_OWN", None)
    planned, pos = cfgmod.plan(sinks, {"hdmi": False})
    assert [p[0] for p in planned] == ["jack", "i2s"], planned


def t_fallback_card():
    planned, pos = cfgmod.plan([("alsa_output.platform-something.analog-stereo", "Odd card", 2)], {"hdmi": False})
    assert planned == []
    planned, pos = cfgmod.fallback_cards([HDMI0, ("alsa_output.platform-something.analog-stereo", "Odd card", 2)])
    assert planned[0][1].startswith("alsa_output.platform-something") and pos == ["FL", "FR"], planned
    text = cfgmod.config_text(planned, pos)
    assert "platform-something" in text, text


def t_fit_channel():
    import instrument_host as ih
    assert ih.fit_channel(4, False, 2) == (1, True, 4), "4 isn't there: 1-2"
    assert ih.fit_channel(3, True, 2) == (1, True, 3)
    assert ih.fit_channel(4, False, 4) == (4, False, 0)
    assert ih.fit_channel(3, True, 4) == (3, True, 0)
    assert ih.fit_channel(2, True, 2) == (2, False, 0), "a pair starting on the last output: that output"
    assert ih.fit_channel(0, False, 2) == (0, False, 0), "off stays off"


def t_card_ids():
    # trixie can name the Pi 4's jack after the firmware mailbox: the ALSA card behind the sink still says Headphones
    jack = ("alsa_output.platform-fe00b840.mailbox.stereo-fallback", "Built-in Audio Stereo", 2, "Headphones|bcm2835 Headphones||")
    hdmi = ("alsa_output.platform-fef00700.hdmi.hdmi-stereo", "Built-in Audio Digital Stereo (HDMI)", 2, "vc4hdmi0|vc4-hdmi-0||")
    usb = ("alsa_output.usb-Focusrite_Scarlett_2i2-00.analog-stereo", "Scarlett 2i2 USB", 2, "USB|Scarlett 2i2 USB||usb")
    usbdac = ("alsa_output.usb-Generic_USB_DAC-00.analog-stereo", "USB DAC", 2, "DAC|USB DAC||usb")
    assert cfgmod.kind_of(jack) == "jack" and cfgmod.kind_of(hdmi) == "hdmi0" and cfgmod.kind_of(usb) == "usb" and cfgmod.kind_of(usbdac) == "usb"
    planned, pos = cfgmod.plan([hdmi, jack], {"hdmi": False})
    assert [p[0] for p in planned] == ["jack"] and planned[0][1] == jack[0] and pos == ["FL", "FR"], planned
    planned, pos = cfgmod.plan([hdmi, usb, jack], {"hdmi": False, "usbFirst": True})
    assert [p[0] for p in planned] == ["usb", "jack"] and len(pos) == 4, planned
    assert cfgmod.channel_names(planned, pos)[:2] == ["Scarlett 2i2 USB L", "Scarlett 2i2 USB R"], cfgmod.channel_names(planned, pos)


def t_forget_targets():
    import tempfile
    home = tempfile.mkdtemp()
    st = os.path.join(home, ".local", "state", "wireplumber")
    os.makedirs(st)
    with open(os.path.join(st, "stream-properties"), "w") as handle:
        handle.write("[stream-properties]\nOutput/Audio:application.name:Chromium={\"volume\":1.0, \"target\":\"alsa_output.platform-fef00700.hdmi.hdmi-stereo\"}\n"
                     "Output/Audio:application.name:Other={\"volume\":0.5}\n")
    assert cfgmod.forget_stream_targets(home) is True
    left = open(os.path.join(st, "stream-properties")).read()
    assert "hdmi" not in left and "Other" in left, left
    assert "restore-target = false" in open(os.path.join(home, ".config", "wireplumber", "wireplumber.conf.d", "padpedal.conf")).read()
    assert cfgmod.forget_stream_targets(home) is False   # (nothing left to change: no restart)


def _own(cards, cfg):
    old = cfgmod.asound_cards
    cfgmod.asound_cards = lambda: cards
    try:
        return cfgmod.own_cards(cfg)
    finally:
        cfgmod.asound_cards = old


def t_dac_listed_first():
    # 10.0.1: the DAC's card listed before the jack (and by WirePlumber with odd names): still jack 1-2, DAC 3-4
    cards = [(0, "sndrpihifiberry"), (1, "Headphones"), (2, "vc4hdmi0"), (3, "vc4hdmi1")]
    own = _own(cards, {"dac": True})
    assert [o[0] for o in own] == ["jack", "i2s"], own
    sinks = [(o[1], o[2], 2, o[3]) for o in own][::-1] + [HDMI0]
    planned, pos = cfgmod.plan(sinks, {"hdmi": False, "dac": True})
    names = cfgmod.channel_names(planned, pos)
    assert names == ["Headphone jack L", "Headphone jack R", "DAC board L", "DAC board R"], names
    text = cfgmod.config_text(planned, pos, own)
    assert 'node.name = "padpedal_jack"' in text and 'api.alsa.path = "hw:CARD=Headphones,DEV=0"' in text and 'hw:CARD=sndrpihifiberry,DEV=0' in text, text
    assert text.index("padpedal_jack") < text.index("padpedal_dac")
    wp = cfgmod.wp_conf(own)
    assert "device.disabled = true" in wp and "Headphones" in wp and "sndrpihifiberry" in wp, wp


def t_no_dac():
    # "A DAC board is fitted" off (the owner's pedal: the overlay was loaded, no board): the DAC is never used, 1-2 = jack
    cards = [(0, "sndrpihifiberry"), (1, "Headphones"), (2, "vc4hdmi0")]
    own = _own(cards, {"dac": False})
    assert [o[0] for o in own] == ["jack"], own
    planned, pos = cfgmod.plan([DAC, (own[0][1], own[0][2], 2, own[0][3]), HDMI0], {"hdmi": False, "dac": False})
    assert [p[0] for p in planned] == ["jack"] and pos == ["FL", "FR"], planned
    assert cfgmod.channel_names(planned, pos) == ["Headphone jack L", "Headphone jack R"]
    assert "sndrpihifiberry" not in cfgmod.wp_conf(own)   # (WirePlumber keeps the DAC's card - nothing plays on it)


def t_no_jack_card():
    # a Pi with no jack (or it switched off): the DAC is first, nothing breaks
    own = _own([(0, "sndrpihifiberry"), (1, "vc4hdmi0")], {"dac": True})
    assert [o[0] for o in own] == ["i2s"], own
    planned, pos = cfgmod.plan([(o[1], o[2], 2, o[3]) for o in own], {"hdmi": False, "dac": True})
    assert [p[0] for p in planned] == ["i2s"] and cfgmod.channel_names(planned, pos)[0] == "DAC board L", planned


print("Sound set-up (Pi):")
check("the ALSA card names the jack / HDMI / USB, whatever PipeWire calls the sink (a USB DAC is USB)", t_card_ids)
check("WirePlumber no longer sends the app to a device it remembers (HDMI): the setting, and the old entry forgotten", t_forget_targets)
check("only the headphone jack: a 2-channel output on the jack (HDMI left out)", t_jack_only)
check("jack + DAC board: 4 channels, jack first", t_jack_dac)
check("waits until every card has its sink (HDMI comes first) - the jack is never left out", t_waits_for_the_jack)
check("no known card: the output PipeWire has is used, not an empty combined output", t_fallback_card)
check("instrument: an output that isn't there plays on 1-2", t_fit_channel)
check("the DAC's card listed before the jack: the jack is still 1-2, the DAC 3-4, both opened straight on ALSA", t_dac_listed_first)
check("no DAC board (switched off, overlay still loaded): nothing goes to the DAC, the jack is 1-2", t_no_dac)
check("no headphone jack card: the DAC board is first", t_no_jack_card)
print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
