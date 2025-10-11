# BLOCKSTREET
Blockstreet auto refer + daily swap and check in Bot


- If you are new, you can join the airdrop here 👉 https://blockstreet.money/dashboard?invite_code=AFSUj4


#Requirements

- capmonster api key to solve captcha



# Clone the repo 

git clone https://github.com/BamarAirdropGroup/BLOCKSTREET.git && cd BLOCKSTREET && npm install


# Add capmonster key in key.txt


  nano key.txt


# Add proxy in proxies.txt

 nano proxies.txt


# For auto refer

- add your refer code in code.txt

  nano code.txt

- Run the ref.js

  node ref.js


💡 ယူလိုက်တဲ့ refer wallet တွေကို wallets.json မှာ auto save ပါမယ် 


# For daily check in and swap 

- add private key in .env (PRIVATE_KEY_1= ,.....  စသည် ဖြင့် )

  nano .env


- run the index.js

 node index.js

💡နောက် bot တခု ထည့် ထားပါတယ် ။အဲ တာ ကတော့ refer ယူလိုက်တဲ့ wallets.json ထဲ က private key တွေကို PRIVATE_KEY_1,2,3 AUTO ပြောင်း ရေးပေးတဲ့ ဟာပါ ။ RUN ပြီးရင် ရေးပြီးသားကို pkey.txt မှာ တွေ့ ပါ မယ်။ ( auto refer bot run ပြီးမှ run ရန် ) 

- Run ဖို့ က

  node convert.js

  ဒါ ဆို pkey.txt မှ ရေးပြီးသား  private key တွေကို copy  ကာ .env မှာ ထည့်ပြီး daily bot run လို့ ရပါပြီ 
 




  

