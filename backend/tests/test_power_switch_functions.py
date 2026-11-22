from routes.power import _parse_status, _supported_switch_code


def test_switch_code_uses_advertised_boolean_relay_function():
    functions = {
        "functions": [
            {"code": "switch_1", "type": "Boolean", "values": "{}"},
            {"code": "switch_2", "type": "Boolean", "values": "{}"},
            {"code": "countdown_1", "type": "Integer", "values": '{"min":0}'},
        ],
    }

    assert _supported_switch_code(functions, "switch_2") == "switch_2"
    assert _supported_switch_code(functions, None) == "switch_1"


def test_switch_led_is_supported_for_tuya_lights():
    functions = {"functions": [
        {"code": "switch_1", "type": "Boolean", "values": "{}"},
        {"code": "switch_led", "type": "Boolean", "values": "{}"},
    ]}

    assert _supported_switch_code(functions, "switch_led") == "switch_led"
    assert _supported_switch_code(functions, None) == "switch_led"
    assert _parse_status([{"code": "switch_led", "value": True}]) == {
        "switch_code": "switch_led",
        "on": True,
    }
    assert _parse_status([
        {"code": "switch_1", "value": False},
        {"code": "switch_led", "value": True},
    ])["switch_code"] == "switch_led"


def test_switch_code_does_not_fall_back_to_unsupported_command():
    functions = {"functions": [{"code": "switch_1", "type": "Integer", "values": "{}"}]}

    assert _supported_switch_code(functions, "switch_1") is None


def test_status_parser_finds_first_switch_datapoint():
    status = [
        {"code": "switch_2", "value": False},
        {"code": "switch_1", "value": True},
    ]

    assert _parse_status(status)["switch_code"] == "switch_1"
