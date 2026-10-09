# OMEX MIS Dashboard (Apps Script)

Har person ki "MIS SUMMARY <naam>" file se weekly score uthata hai, MAIN MIS SYSTEM ke `MIS_DATA` tab me jama karta hai, aur ek web-app dashboard dikhata hai.
Dashboard me koi bhi date chuno, us din ka Monday–Sunday week khulega.

## Files

| File | Kya karti hai |
|---|---|
| `Code.gs` | Links padhna, har summary parse karna, `MIS_DATA` likhna, users/roles, web app ka data |
| `Index.html` | Dashboard: date picker, Team view, Person view, trends, by-system |
| `appsscript.json` | Timezone (IST), web-app settings, permissions |

## Setup (ek baar)

1. MAIN MIS SYSTEM kholo → **Extensions → Apps Script**.
2. `Code.gs` me poora code paste karo. **+ → HTML** se `Index` naam ki file banao, usme `Index.html` paste karo.
3. Project Settings → "Show appsscript.json" on karo, `appsscript.json` paste karo. Save.
4. Sheet refresh karo. Menu me **MIS Dashboard** aayega:
   - **1. Setup tabs**: `MIS_DATA`, `USERS`, `MIS_LOG` tabs banenge. `USERS` me sab logon ke naam pehle se bhar jayenge.
   - `USERS` tab me har person ki **email** bharo. Role `ADMIN` = poori team dikhegi, `USER` = sirf apna page.
   - **2. Capture this week now**: abhi ka week `MIS_DATA` me aa jayega. Kuch fail ho to `MIS_LOG` dekho.
   - **3. Turn on weekly capture**: har Saturday 7 pm apne aap capture hoga.
5. **Deploy → New deployment → Web app**. Execute as: *Me*, Who has access: *Anyone within omexgears.com*. Jo URL mile wahi dashboard hai.

## Dhyan rakhne wali baatein

- History us din se banegi jis din pehla capture chalega. Usse pehle ke week chunoge to dashboard batayega ki us week ka data nahi hai.
- Score har person ki "MIS Summary Sheet" se aata hai, isliye uska SETUP (date window) sahi hona chahiye. Abhi Sandhya, Rajinder, Abhishek ke window mahino lambe hain. Sab ka Monday–Sunday karo.
- Done % = Done ÷ Planned. On time % = On time ÷ Done. 90%+ On track, 75%+ Watch, usse kam Behind (`CFG.GOOD`, `CFG.WATCH` me badal sakte ho).
- Mamta aur Dheeraj ki summary abhi template hai ("System Name"), wo skip ho jayegi jab tak setup nahi hoti.
- Links column ya tab ka naam badle to `CFG.LINKS_TAB`, `CFG.COL_PERSON`, `CFG.COL_LINK` update karo.
