# RFM69RADIO
A Node module for sending and receiving through RFM69 radios on the Raspberry Pi.

Ported from [etrombly's python version](https://github.com/etrombly) of the [LowPowerLab code](https://github.com/LowPowerLab/RFM69).

## Hardware
This version tested on a pair of [Adafruit RFM69HCW Radios](https://learn.adafruit.com/adafruit-rfm69hcw-and-rfm96-rfm95-rfm98-lora-packet-padio-breakouts/overview) with this NodeJS code running on a [Raspberry Pi 3 Model B](https://www.raspberrypi.org/products/raspberry-pi-3-model-b/). 

The default wiring is:

| RFM pin | Pi pin  
| ------- |-------
| 3v3     | 17  
| DIO0    | 18 (GPIO24)  
| MOSI    | 19 (GPIO10)
| MISO    | 21 (GPIO09)
| CLK     | 23 (GPIO11)
| CS (NSS)| 24 (GPIO08 CS0)
| Ground  | 25  
| RESET   | 29 (GPIO05)

See [here for the Raspberry Pi 3 GPIO pins](https://docs.microsoft.com/en-us/windows/iot-core/learn-about-hardware/pinmappings/pinmappingsrpi).

The second radio is connected to an Arduino UNO running the code in [frm69_test.ino](https://github.com/AndyFlem/rfm69radio/blob/master/frm69_test/rfm69_test.ino) and connected according to the instrucitons from [Adafruit](https://learn.adafruit.com/adafruit-rfm69hcw-and-rfm96-rfm95-rfm98-lora-packet-padio-breakouts/arduino-wiring).

## Install
`npm install rfm69radio`

## Usage

