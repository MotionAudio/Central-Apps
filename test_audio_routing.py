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
    try:
        sinks = cfgmod.wait_for_sinks({}, {"hdmi": False}, timeout=5)
    finally:
        cfgmod.pw_sinks, cfgmod.asound_cards, cfgmod.time.sleep = old_s, old_c, old_sleep
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


print("Sound set-up (Pi):")
check("only the headphone jack: a 2-channel output on the jack (HDMI left out)", t_jack_only)
check("jack + DAC board: 4 channels, jack first", t_jack_dac)
check("waits until every card has its sink (HDMI comes first) - the jack is never left out", t_waits_for_the_jack)
check("no known card: the output PipeWire has is used, not an empty combined output", t_fallback_card)
check("instrument: an output that isn't there plays on 1-2", t_fit_channel)
print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
