# Zwift Hub FTMS Protocol Findings

## Summary
From analyzing the Whoosh Bluetooth capture (`zwfit-log1.pklg`), I discovered that the Zwift Hub uses **FTMS (Fitness Machine Service)** for workout control, NOT the Cycling Power Service with DirCon protocol.

## Key Discoveries

### 1. Service & Characteristics Used
- **Service**: Fitness Machine Service (UUID: 0x1826)
- **Control Point**: Fitness Machine Control Point (UUID: 0x2AD9, Handle: 0x0027)
- **Response**: Handle 0x0020 for notifications

### 2. Commands Found in Capture

#### Request Control (Required First)
```
Command: 11 00 00 14 00 28 33
  - Opcode: 0x11 (Request Control)
  - Must be sent before any Set Target Power commands
  
Response: 12 00 00 14 00 28 33
  - 0x12 = Success response
```

#### Set Target Power
```
Format: 05 <power_low> <power_high>

Examples from capture:
  114W: 05 72 00
  115W: 05 73 00
  116W: 05 74 00
  
Response: 08 <power_low> <power_high>
  - 0x08 = Response code
  - Echoes back the power value
```

### 3. Protocol Details
- Commands are sent **directly** to the FTMS Control Point
- **NO DirCon wrapping** needed
- Uses standard BLE GATT Write Request (opcode 0x12)
- Responses come via notifications on the same characteristic

## Changes Made to zwift_hub_working.html

1. **Removed DirCon Protocol**: Deleted all the DirCon wrapper code
2. **Added FTMS Service**: Now connects to Fitness Machine Service (0x1826)
3. **Added initializeFTMS()**: Sends Request Control command on connection
4. **Simplified Commands**: Direct 3-byte FTMS commands instead of wrapped messages
5. **Response Handling**: Logs all FTMS responses for debugging

## How to Test

1. Open `zwift_hub_working.html` in a browser (requires HTTPS or localhost)
2. Click "Connect Hub" and select your Zwift Hub
3. Watch the log for:
   - "Initializing FTMS..."
   - "✓ FTMS Control requested"
   - "FTMS Response: 0x12 0x00 0x00 0x14 0x00 0x28 0x33" (success!)
4. Set a target power (e.g., 100W) and click "Send Power Command"
5. Watch for response: "FTMS Response: 0x08 0x64 0x00" (100W confirmed)
6. Try the ramp workout to see gradual power changes

## Expected Behavior

- Connection should work exactly as before (metrics display)
- Power commands should now actually control the resistance!
- The trainer should adjust to match the target power
- Responses in the log confirm each command

## Troubleshooting

If power control doesn't work:
1. Check that "FTMS Response" appears with 0x12 (success) after Request Control
2. Verify responses show 0x08 after Set Target Power commands
3. Try cycling power on the trainer (disconnect/reconnect)
4. Check browser console for any errors

## References

- FTMS Specification: Bluetooth SIG Fitness Machine Service
- Captured from: Whoosh app workout session
- Date: October 26, 2025
