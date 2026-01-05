
const express = require("express");
const db = require("../db");
const otpGenerator = require("otp-generator");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const router = express.Router();
const MAX_ATTEMPTS = 3;

function log(api, status, msg) {
  db.query(
    "INSERT INTO audit_logs(api_name,status,message,trace_id) VALUES (?,?,?,?)",
    [api, status, msg, crypto.randomUUID()]
  );
}

router.post("/send-otp", (req, res) => {
  const { email, mobile } = req.body;
  if (!email && !mobile) return res.status(400).json({message:"Email or mobile required"});

  db.query(
    "SELECT * FROM users WHERE email=? OR mobile=?",
    [email, mobile],
    (e, r) => {
      const user = r[0];
      const createUser = cb => {
        if (user) return cb(user.id);
        db.query(
          "INSERT INTO users(email,mobile) VALUES(?,?)",
          [email, mobile],
          (_, result) => cb(result.insertId)
        );
      };

      createUser(userId => {
        const otp = otpGenerator.generate(6,{digits:true});
        const hash = crypto.createHash("sha256").update(otp).digest("hex");
        const expiry = new Date(Date.now()+5*60000);

        db.query(
          "INSERT INTO otp_requests(user_id,otp_hash,expires_at) VALUES(?,?,?)",
          [userId, hash, expiry]
        );

        log("SEND_OTP","SUCCESS","OTP generated");
        res.json({message:"OTP sent"});
      });
    }
  );
});

router.post("/verify-otp", (req,res)=>{
  const { email, otp } = req.body;
  const hash = crypto.createHash("sha256").update(otp).digest("hex");

  db.query(
    `SELECT o.* FROM otp_requests o
     JOIN users u ON u.id=o.user_id
     WHERE u.email=? AND o.verified=FALSE
     ORDER BY o.created_at DESC LIMIT 1`,
    [email],
    (_, r)=>{
      if(!r.length) return res.status(400).json({message:"OTP not found"});
      const row=r[0];

      if(row.attempts>=MAX_ATTEMPTS)
        return res.status(403).json({message:"Blocked"});

      if(new Date()>row.expires_at)
        return res.status(400).json({message:"Expired"});

      if(row.otp_hash!==hash){
        db.query("UPDATE otp_requests SET attempts=attempts+1 WHERE id=?",[row.id]);
        log("VERIFY_OTP","FAILED","Wrong OTP");
        return res.status(400).json({message:"Invalid OTP"});
      }

      db.query("UPDATE otp_requests SET verified=TRUE WHERE id=?",[row.id]);
      log("VERIFY_OTP","SUCCESS","Login complete");
      res.json({message:"Login successful"});
    }
  );
});

module.exports = router;
