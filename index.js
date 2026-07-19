import express from 'express'
import axios from 'axios'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const app = express()
app.use(express.json())

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY })
const TOKEN = process.env.WHATSAPP_TOKEN
const PHONE_ID = process.env.PHONE_NUMBER_ID

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge'])
  res.sendStatus(403)
})

async function sendText(to, text) {
  await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to, text: { body: text }
  }, { headers: { Authorization: `Bearer ${TOKEN}` } })
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200)
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    if (!msg) return
    const from = msg.from
    const text = msg.text?.body || ""
    const buttonId = msg.interactive?.list_reply?.id

    const { data: shops } = await supabase.from('shops').select('*').eq('phone_number_id', PHONE_ID).limit(1)
    const shop = shops[0]
    const { data: products } = await supabase.from('products').select('*').eq('shop_id', shop.id)

    if (buttonId) {
      const product = products.find(p => p.id === buttonId)
      await supabase.from('orders').insert({ shop_id: shop.id, customer_wa_id: from, items: [{...product, qty:1}], total: product.price, status: 'awaiting_qty' })
      await sendText(from, `You picked *${product.name}* - ₦${(product.price/100).toLocaleString()}\nHow many?`)
      return
    }

    if (text) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: `You are SABI, Lagos shop assistant for ${shop.business_name}. Products: ${products.map(p=>p.name).join(", ")}. Customer: ${text}. Reply Pidgin if they use Pidgin, max 2 lines, friendly.` }],
        max_tokens: 100
      })
      await sendText(from, completion.choices[0].message.content)
      if (text.toLowerCase().includes("hi") || text.toLowerCase().includes("catalog")) {
        const rows = products.map(p => ({ id: p.id, title: `${p.name.slice(0,22)} - ₦${p.price/100}`, description: "Tap to buy" }))
        await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
          messaging_product: "whatsapp", to: from, type: "interactive",
          interactive: { type: "list", body: { text: `🔥 ${shop.business_name} Catalog` }, action: { button: "View Products", sections: [{ title: "Products", rows }] } }
        }, { headers: { Authorization: `Bearer ${TOKEN}` } })
      }
    }
  } catch(e){ console.log(e.response?.data || e.message) }
})

app.get('/', (req,res)=>res.send('SABI LIVE'))
app.listen(3000, ()=>console.log('SABI LIVE'))
