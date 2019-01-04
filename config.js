const reg=require('./registers')

const frfMSB = {RF69_315MHZ: reg.RF_FRFMSB_315, RF69_433MHZ: reg.RF_FRFMSB_433, RF69_868MHZ: reg.RF_FRFMSB_868, RF69_915MHZ: reg.RF_FRFMSB_915}
const frfMID = {RF69_315MHZ: reg.RF_FRFMID_315, RF69_433MHZ: reg.RF_FRFMID_433, RF69_868MHZ: reg.RF_FRFMID_868, RF69_915MHZ: reg.RF_FRFMID_915}
const frfLSB = {RF69_315MHZ: reg.RF_FRFLSB_315, RF69_433MHZ: reg.RF_FRFLSB_433, RF69_868MHZ: reg.RF_FRFLSB_868, RF69_915MHZ: reg.RF_FRFLSB_915}



module.exports.getConfig=function(freqBand, networkID) {
    const config=new Map();
 
    config.set(reg.REG_OPMODE, reg.RF_OPMODE_SEQUENCER_ON | reg.RF_OPMODE_LISTEN_OFF | reg.RF_OPMODE_STANDBY)
    //no shaping
    config.set(reg.REG_DATAMODUL, reg.RF_DATAMODUL_DATAMODE_PACKET | reg.RF_DATAMODUL_MODULATIONTYPE_FSK | reg.RF_DATAMODUL_MODULATIONSHAPING_00)
    //default:4.8 KBPS
    config.set(reg.REG_BITRATEMSB, reg.RF_BITRATEMSB_55555)
    config.set(reg.REG_BITRATELSB, reg.RF_BITRATELSB_55555)
    //default:5khz, (FDEV + BitRate/2 <= 500Khz)
    config.set(reg.REG_FDEVMSB, reg.RF_FDEVMSB_50000)
    config.set(reg.REG_FDEVLSB, reg.RF_FDEVLSB_50000)

    config.set(reg.REG_FRFMSB, frfMSB[freqBand])
    config.set(reg.REG_FRFMID, frfMID[freqBand])
    config.set(reg.REG_FRFLSB, frfLSB[freqBand])

    // looks like PA1 and PA2 are not implemented on RFM69W, hence the max output power is 13dBm
    // +17dBm and +20dBm are possible on RFM69HW
    // +13dBm formula: Pout=-18+OutputPower (with PA0 or PA1**)
    // +17dBm formula: Pout=-14+OutputPower (with PA1 and PA2)**
    // +20dBm formula: Pout=-11+OutputPower (with PA1 and PA2)** and high power PA settings (section 3.3.7 in datasheet)
    //0x11: [REG_PALEVEL, RF_PALEVEL_PA0_ON | RF_PALEVEL_PA1_OFF | RF_PALEVEL_PA2_OFF | RF_PALEVEL_OUTPUTPOWER_11111,
    //over current protection (default is 95mA)
    //0x13: [REG_OCP, RF_OCP_ON | RF_OCP_TRIM_95,

    // RXBW defaults are { REG_RXBW, RF_RXBW_DCCFREQ_010 | RF_RXBW_MANT_24 | RF_RXBW_EXP_5} (RxBw: 10.4khz)
    ////(BitRate < 2 * RxBw)
    config.set(reg.REG_RXBW, reg.RF_RXBW_DCCFREQ_010 | reg.RF_RXBW_MANT_16 | reg.RF_RXBW_EXP_2)
    //for BR-19200: //* 0x19 */ { REG_RXBW, RF_RXBW_DCCFREQ_010 | RF_RXBW_MANT_24 | RF_RXBW_EXP_3 },
    //DIO0 is the only IRQ we're using
    config.set(reg.REG_DIOMAPPING1, reg.RF_DIOMAPPING1_DIO0_01)
    //must be set to dBm = (-Sensitivity / 2) - default is 0xE4=228 so -114dBm
    config.set(reg.REG_RSSITHRESH, 220)
    ///* 0x2d */ { REG_PREAMBLELSB, RF_PREAMBLESIZE_LSB_VALUE } // default 3 preamble bytes 0xAAAAAA
    config.set(reg.REG_SYNCCONFIG, reg.RF_SYNC_ON | reg.RF_SYNC_FIFOFILL_AUTO | reg.RF_SYNC_SIZE_2 | reg.RF_SYNC_TOL_0)
    //attempt to make this compatible with sync1 byte of RFM12B lib
    config.set(reg.REG_SYNCVALUE1, 0x2D)
    //NETWORK ID
    config.set(reg.REG_SYNCVALUE2, networkID)
    config.set(reg.REG_PACKETCONFIG1, reg.RF_PACKET1_FORMAT_VARIABLE | reg.RF_PACKET1_DCFREE_OFF | reg.RF_PACKET1_CRC_ON | reg.RF_PACKET1_CRCAUTOCLEAR_ON | reg.RF_PACKET1_ADRSFILTERING_OFF)
    
    //in variable length mode: the max frame size, not used in TX
    config.set(reg.REG_PAYLOADLENGTH, 66)
    //* 0x39 */ { REG_NODEADRS, nodeID }, //turned off because we're not using address filtering
    //TX on FIFO not empty
    config.set(reg.REG_FIFOTHRESH, reg.RF_FIFOTHRESH_TXSTART_FIFONOTEMPTY | reg.RF_FIFOTHRESH_VALUE)
    //RXRESTARTDELAY must match transmitter PA ramp-down time (bitrate dependent)
    config.set(reg.REG_PACKETCONFIG2, reg.RF_PACKET2_RXRESTARTDELAY_2BITS | reg.RF_PACKET2_AUTORXRESTART_ON | reg.RF_PACKET2_AES_OFF)
    //for BR-19200: //* 0x3d */ { REG_PACKETCONFIG2, RF_PACKET2_RXRESTARTDELAY_NONE | RF_PACKET2_AUTORXRESTART_ON | RF_PACKET2_AES_OFF }, //RXRESTARTDELAY must match transmitter PA ramp-down time (bitrate dependent)
    //* 0x6F */ { REG_TESTDAGC, RF_DAGC_CONTINUOUS }, // run DAGC continuously in RX mode
    // run DAGC continuously in RX mode, recommended default for AfcLowBetaOn=0
    config.set(reg.REG_TESTDAGC, reg.RF_DAGC_IMPROVED_LOWBETA0)
    config.set(255, 0)

    return config;
}
