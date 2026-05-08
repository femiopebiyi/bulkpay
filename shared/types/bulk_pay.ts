/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/bulk_pay.json`.
 */
export type BulkPay = {
  "address": "Bh6ADbE6SmBjta1YYSGvMp3i4Tqomey9NcFdpgHJAhpT",
  "metadata": {
    "name": "bulkPay",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "bulkTransfer",
      "discriminator": [
        44,
        36,
        19,
        135,
        162,
        120,
        232,
        35
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "userAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "senderAtaToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "transferLog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "recipients",
          "type": {
            "vec": {
              "defined": {
                "name": "recipient"
              }
            }
          }
        }
      ]
    },
    {
      "name": "closeSchedule",
      "discriminator": [
        61,
        207,
        168,
        139,
        106,
        172,
        225,
        12
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "scheduleAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  104,
                  101,
                  100,
                  117,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "schedule_account.created_at",
                "account": "scheduleAccount"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createAccount",
      "discriminator": [
        99,
        20,
        130,
        119,
        196,
        235,
        131,
        149
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createSchedule",
      "discriminator": [
        200,
        176,
        213,
        214,
        210,
        121,
        35,
        225
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "delegationAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              },
              {
                "kind": "arg",
                "path": "createdAt"
              }
            ]
          }
        },
        {
          "name": "scheduleAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  104,
                  101,
                  100,
                  117,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "arg",
                "path": "createdAt"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "recipients",
          "type": {
            "vec": {
              "defined": {
                "name": "scheduledRecipient"
              }
            }
          }
        },
        {
          "name": "recurrence",
          "type": {
            "defined": {
              "name": "recurrence"
            }
          }
        },
        {
          "name": "firstRunAt",
          "type": "i64"
        },
        {
          "name": "maxRuns",
          "type": "u32"
        },
        {
          "name": "createdAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "delegate",
      "discriminator": [
        90,
        147,
        75,
        178,
        85,
        88,
        4,
        137
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "delegationAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              },
              {
                "kind": "arg",
                "path": "createdAt"
              }
            ]
          }
        },
        {
          "name": "senderAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "schedulerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  104,
                  101,
                  100,
                  117,
                  108,
                  101,
                  114,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxAmount",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "createdAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "executeSchedule",
      "discriminator": [
        213,
        170,
        208,
        111,
        88,
        141,
        23,
        232
      ],
      "accounts": [
        {
          "name": "executor",
          "writable": true,
          "signer": true
        },
        {
          "name": "sender"
        },
        {
          "name": "scheduleAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  104,
                  101,
                  100,
                  117,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "arg",
                "path": "createdAt"
              }
            ]
          }
        },
        {
          "name": "delegationAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              },
              {
                "kind": "arg",
                "path": "createdAt"
              }
            ]
          }
        },
        {
          "name": "senderAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "transferLog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "schedulerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  104,
                  101,
                  100,
                  117,
                  108,
                  101,
                  114,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "createdAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initTransferLog",
      "discriminator": [
        5,
        229,
        133,
        228,
        246,
        224,
        111,
        6
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "transferLog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "revokeDelegation",
      "discriminator": [
        188,
        92,
        135,
        67,
        160,
        181,
        54,
        62
      ],
      "accounts": [
        {
          "name": "sender",
          "signer": true
        },
        {
          "name": "delegationAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "senderAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "delegationAccount",
      "discriminator": [
        84,
        214,
        213,
        219,
        161,
        8,
        165,
        130
      ]
    },
    {
      "name": "scheduleAccount",
      "discriminator": [
        178,
        112,
        177,
        175,
        58,
        170,
        225,
        160
      ]
    },
    {
      "name": "transferLog",
      "discriminator": [
        223,
        210,
        20,
        28,
        225,
        53,
        244,
        252
      ]
    },
    {
      "name": "userAccount",
      "discriminator": [
        211,
        33,
        136,
        16,
        186,
        110,
        242,
        127
      ]
    }
  ],
  "events": [
    {
      "name": "scheduleCancelled",
      "discriminator": [
        3,
        155,
        30,
        237,
        188,
        100,
        170,
        155
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAccountCount",
      "msg": "remaining_accounts must be exactly 2 per recipient"
    },
    {
      "code": 6001,
      "name": "invalidRecipient",
      "msg": "Wallet does not match recipient address"
    },
    {
      "code": 6002,
      "name": "invalidAta",
      "msg": "ATA does not match derived address"
    },
    {
      "code": 6003,
      "name": "ataNotWritable",
      "msg": "ATA account is not writable"
    },
    {
      "code": 6004,
      "name": "invalidWallet",
      "msg": "Wallet account is executable — not a valid recipient"
    },
    {
      "code": 6005,
      "name": "insufficientBalance",
      "msg": "Sender has insufficient token balance"
    },
    {
      "code": 6006,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6007,
      "name": "unauthorized",
      "msg": "Unauthorized — signer does not own this account"
    },
    {
      "code": 6008,
      "name": "nameTooLong",
      "msg": "Recipient name exceeds maximum length"
    },
    {
      "code": 6009,
      "name": "invalidMint",
      "msg": "There is a mint mismatch, not the expected mint"
    },
    {
      "code": 6010,
      "name": "delegationInactive",
      "msg": "Delegation has been revoked or does not exist"
    },
    {
      "code": 6011,
      "name": "delegationExpired",
      "msg": "Delegation has expired"
    },
    {
      "code": 6012,
      "name": "exceedsDelegationLimit",
      "msg": "Transfer amount exceeds delegated maximum"
    },
    {
      "code": 6013,
      "name": "scheduleInactive",
      "msg": "Schedule is not active"
    },
    {
      "code": 6014,
      "name": "scheduleNotDue",
      "msg": "Schedule is not due yet"
    },
    {
      "code": 6015,
      "name": "scheduleExhausted",
      "msg": "Schedule has completed all runs"
    },
    {
      "code": 6016,
      "name": "invalidSchedulerAuthority",
      "msg": "Scheduler authority does not match"
    },
    {
      "code": 6017,
      "name": "ataNotCreated",
      "msg": "ATA does not exist — run the pre-ATA pass before executing a schedule"
    },
    {
      "code": 6018,
      "name": "invalidDelegationAmount",
      "msg": "The amount provided is not a valid amount"
    },
    {
      "code": 6019,
      "name": "scheduleStillActive",
      "msg": "This schedule is still active"
    },
    {
      "code": 6020,
      "name": "delegationStillActive",
      "msg": "This delegation is still active"
    },
    {
      "code": 6021,
      "name": "invalidCreatedAt",
      "msg": "created_at is outside acceptable window — must be within 5 minutes of current time"
    },
    {
      "code": 6022,
      "name": "batchTooLarge",
      "msg": "Batch exceeds maximum of 35 recipients per transaction"
    },
    {
      "code": 6023,
      "name": "invalidExpiry",
      "msg": "new expiry must be in the future"
    },
    {
      "code": 6024,
      "name": "expiryCannotDecrease",
      "msg": "Expiry date cannot decrease"
    }
  ],
  "types": [
    {
      "name": "delegationAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "maxAmount",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "recipient",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amountToBeReceived",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "recurrence",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "once"
          },
          {
            "name": "daily"
          },
          {
            "name": "weekly"
          },
          {
            "name": "monthly"
          }
        ]
      }
    },
    {
      "name": "scheduleAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "recurrence",
            "type": {
              "defined": {
                "name": "recurrence"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "nextRunAt",
            "type": "i64"
          },
          {
            "name": "maxRuns",
            "type": "u32"
          },
          {
            "name": "runsCompleted",
            "type": "u32"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "recipients",
            "type": {
              "vec": {
                "defined": {
                  "name": "scheduledRecipient"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "scheduleCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "schedule",
            "type": "pubkey"
          },
          {
            "name": "runsCompleted",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "scheduledRecipient",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "transferLog",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "records",
            "type": {
              "vec": {
                "defined": {
                  "name": "transferRecord"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "transferRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "type": "pubkey"
          },
          {
            "name": "amountReceived",
            "type": "u64"
          },
          {
            "name": "totalAllTimeReceived",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "allTimeAmountSent",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "isCreated",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
