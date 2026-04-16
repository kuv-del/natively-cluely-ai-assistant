//! Acoustic Echo Cancellation using WebRTC AEC3 (via aec3 crate's VoIP API).
//!
//! Subtracts the system audio (speaker output / reference signal) from the
//! microphone capture to produce a clean "local speaker only" stream.

use std::sync::Mutex;
use aec3::voip::{VoipAec3, VoipAec3Builder};

pub struct AecProcessor {
    inner: Mutex<VoipAec3>,
    frame_size: usize,
}

impl AecProcessor {
    pub fn new(sample_rate: u32) -> Self {
        let aec = VoipAec3Builder::new(sample_rate as usize, 1, 1)
            .build()
            .expect("Failed to create VoipAec3");
        let frame_size = aec.capture_frame_samples();
        println!("[AEC] Created: {}Hz, frame_size={}", sample_rate, frame_size);
        Self {
            inner: Mutex::new(aec),
            frame_size,
        }
    }

    /// Feed speaker/system audio as reference signal (f32 samples).
    pub fn feed_reference_f32(&self, samples: &[f32]) {
        let mut aec = self.inner.lock().unwrap();
        for chunk in samples.chunks(self.frame_size) {
            if chunk.len() == self.frame_size {
                let _ = aec.handle_render_frame(chunk);
            }
        }
    }

    /// Process mic capture, removing echo. Returns cleaned f32 samples.
    pub fn process_capture_f32(&self, samples: &[f32]) -> Vec<f32> {
        let mut aec = self.inner.lock().unwrap();
        let mut output = Vec::with_capacity(samples.len());
        let mut out_frame = vec![0.0f32; self.frame_size];

        for chunk in samples.chunks(self.frame_size) {
            if chunk.len() == self.frame_size {
                let _ = aec.process_capture_frame(chunk, false, &mut out_frame);
                output.extend_from_slice(&out_frame);
            } else {
                // Remainder — pass through
                output.extend_from_slice(chunk);
            }
        }

        output
    }

    /// Feed i16 reference samples (convenience wrapper).
    pub fn feed_reference_i16(&self, samples_i16: &[i16]) {
        let float_samples: Vec<f32> = samples_i16.iter().map(|&s| s as f32 / 32768.0).collect();
        self.feed_reference_f32(&float_samples);
    }

    /// Process i16 capture samples, return cleaned i16 (convenience wrapper).
    pub fn process_capture_i16(&self, samples_i16: &[i16]) -> Vec<i16> {
        let float_samples: Vec<f32> = samples_i16.iter().map(|&s| s as f32 / 32768.0).collect();
        let cleaned = self.process_capture_f32(&float_samples);
        cleaned.iter().map(|&s| (s * 32767.0).clamp(-32768.0, 32767.0) as i16).collect()
    }

    pub fn frame_size(&self) -> usize {
        self.frame_size
    }
}
