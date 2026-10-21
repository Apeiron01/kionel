package dev.kionel.enroll

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import android.util.Base64

/**
 * Kionel cihaz kimliği kaydı.
 *
 * Tek işi var: StrongBox içinde, enrollment servisinin verdiği tek kullanımlık
 * challenge'a bağlı bir P-256 imza anahtarı üretmek ve Android'in döndürdüğü
 * attestation zincirini dışarı vermek.
 *
 * Anahtarın kendisi asla bu sınıftan çıkmaz — çıkamaz da; AndroidKeyStore
 * özel anahtarı uygulama belleğine hiç vermez.
 *
 * StrongBox yoksa AKIŞ DURUR. TEE'ye sessizce düşmek, kurumun StrongBox
 * sandığı bir cihazın aslında StrongBox olmaması demektir; Windows hostundaki
 * "yazılım anahtarına fallback yasak" kuralının Android karşılığı budur.
 */
class MainActivity : Activity() {

    private val alias = "kionel.device.v2"
    private var pendingEvidence: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val challengeField = findViewById<EditText>(R.id.challenge)
        val output = findViewById<TextView>(R.id.output)
        val enrollButton = findViewById<Button>(R.id.enroll)
        val saveButton = findViewById<Button>(R.id.save)

        enrollButton.setOnClickListener {
            val challenge = try {
                decodeChallenge(challengeField.text.toString().trim())
            } catch (error: Throwable) {
                output.text = getString(R.string.enrollment_failed, error.message)
                return@setOnClickListener
            }
            pendingEvidence = null
            saveButton.isEnabled = false
            enrollButton.isEnabled = false
            output.setText(R.string.working)

            Thread {
                val result = runCatching { enroll(challenge).toString(2) }
                runOnUiThread {
                    enrollButton.isEnabled = true
                    result.onSuccess { json ->
                        pendingEvidence = json
                        saveButton.isEnabled = true
                        output.text = getString(R.string.enrollment_ready, json.take(4000))
                    }.onFailure { error ->
                        output.text = getString(R.string.enrollment_failed, error.message)
                    }
                }
            }.start()
        }

        saveButton.setOnClickListener {
            if (pendingEvidence == null) return@setOnClickListener
            startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, "kionel-android-attestation.json")
            }, EXPORT_REQUEST)
        }
    }

    @Deprecated("Platform callback retained for minSdk 28 without an AndroidX dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != EXPORT_REQUEST || resultCode != RESULT_OK) return
        val json = pendingEvidence ?: return
        val uri = data?.data ?: return
        val output = findViewById<TextView>(R.id.output)
        runCatching {
            contentResolver.openOutputStream(uri, "wt")?.bufferedWriter(Charsets.UTF_8).use { writer ->
                requireNotNull(writer) { "kanıt dosyası açılamadı" }
                writer.write(json)
            }
        }.onSuccess {
            output.text = getString(R.string.evidence_saved, uri)
        }.onFailure { error ->
            output.text = getString(R.string.evidence_save_failed, error.message)
        }
    }

    /** Challenge enrollment servisinden gelir; cihaz kendi challenge'ını üretemez. */
    private fun decodeChallenge(value: String): ByteArray {
        require(value.isNotEmpty()) { "enrollment challenge girilmedi" }
        val decoded = Base64.decode(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        require(decoded.size in 16..64) { "challenge 16..64 bayt olmalı" }
        return decoded
    }

    private fun enroll(challenge: ByteArray): JSONObject {
        require(packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)) {
            "bu cihaz StrongBox özelliği bildirmiyor; Kionel Enterprise kaydı yapılamaz"
        }
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)

        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
            .setIsStrongBoxBacked(true)
            .build()

        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        try {
            generator.initialize(spec)
            generator.generateKeyPair()
        } catch (unavailable: StrongBoxUnavailableException) {
            // Fail closed. Zayıf anahtar üretmektense kayıt yapmamak doğrudur.
            throw IllegalStateException("bu cihazda StrongBox yok; Kionel Enterprise kaydı yapılamaz", unavailable)
        }

        val chain = keyStore.getCertificateChain(alias)
            ?: throw IllegalStateException("attestation zinciri alınamadı")
        require(chain.size in 1..12) { "attestation zinciri 1..12 sertifika olmalı" }

        val leaf = chain.first() as X509Certificate
        val point = (leaf.publicKey as ECPublicKey).let { key ->
            require(key.params.curve.field.fieldSize == 256) { "üretilen anahtar P-256 değil" }
            val x = coordinate(key.w.affineX.toByteArray())
            val y = coordinate(key.w.affineY.toByteArray())
            ByteArray(65).also {
                it[0] = 4
                x.copyInto(it, 1)
                y.copyInto(it, 33)
            }
        }

        val pems = JSONArray()
        for (certificate in chain) pems.put(pem(certificate.encoded))

        return JSONObject()
            .put("providerId", "android-keystore")
            .put("keyId", "android:$alias")
            .put("algorithm", "ecdsa-p256-sha256")
            .put("publicKey", b64url(point))
            .put("securityLevel", "strongbox")
            .put("persistence", "persistent")
            .put("requiresUserPresence", false)
            .put("attestationEvidence", JSONObject()
                .put("format", "android-key-attestation")
                .put("certificateChain", pems))
    }

    private fun b64url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun coordinate(bytes: ByteArray): ByteArray {
        val unsigned = bytes.dropWhile { it == 0.toByte() }.takeLast(32).toByteArray()
        require(unsigned.size <= 32) { "EC koordinatı P-256 sınırını aşıyor" }
        return ByteArray(32).also { unsigned.copyInto(it, 32 - unsigned.size) }
    }

    private fun pem(der: ByteArray): String {
        val body = Base64.encodeToString(der, Base64.NO_WRAP).chunked(64).joinToString("\n")
        return "-----BEGIN CERTIFICATE-----\n$body\n-----END CERTIFICATE-----\n"
    }

    private companion object {
        const val EXPORT_REQUEST = 1001
    }
}
