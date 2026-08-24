use crate::error::AudioError;
use crate::audio::config::AudioConfig;
use cpal;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct AudioOutput {
    stream: cpal::Stream,
    is_paused: Arc<AtomicBool>,
}

impl AudioOutput {
    pub fn start(
        config: &AudioConfig,
        device: Option<&cpal::Device>,
        mut data_callback: impl FnMut(&mut [f32]) + Send + 'static,
    ) -> Result<Self, AudioError> {
        let device: cpal::Device = match device {
            Some(d) => d.clone(),
            None => select_device(config)
                .ok_or_else(|| AudioError::ConfigError("No compatible output device found".to_string()))?,
        };

        let is_paused = Arc::new(AtomicBool::new(false));
        let is_paused_clone = is_paused.clone();

        let stream_config = config.to_stream_config();

        let stream = device.build_output_stream(
            &stream_config,
            move |data: &mut [f32], _| {
                if !is_paused_clone.load(Ordering::Relaxed) {
                    data_callback(data);
                } else {
                    data.fill(0.0);
                }
            },
            move |err| {
                eprintln!("Audio stream error: {:?}", err);
            },
            None,
        )
        .map_err(|e| AudioError::OutputError(e.to_string()))?;

        stream
            .play()
            .map_err(|e| AudioError::OutputError(e.to_string()))?;

        Ok(Self { stream, is_paused })
    }

    pub fn pause(&self) {
        self.is_paused.store(true, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.is_paused.store(false, Ordering::Relaxed);
    }

    pub fn stop(self) {
        let _ = self.stream.pause();
    }
}

pub fn device_supports(device: &cpal::Device, config: &AudioConfig) -> bool {
    match device.supported_output_configs() {
        Ok(mut configs) => configs.any(|c| {
            c.channels() == config.channels
                && c.min_sample_rate() <= cpal::SampleRate(config.sample_rate)
                && c.max_sample_rate() >= cpal::SampleRate(config.sample_rate)
        }),
        Err(_) => false,
    }
}

fn select_device(config: &AudioConfig) -> Option<cpal::Device> {
    let host = cpal::default_host();
    let devices: Vec<_> = host.output_devices().ok()?.collect();
    devices.into_iter().find(|device| device_supports(device, config))
}

pub fn prompt_device_selection() -> Result<cpal::Device, AudioError> {
    let host = cpal::default_host();
    let devices: Vec<_> = host
        .output_devices()
        .map_err(|e| AudioError::OutputError(e.to_string()))?
        .collect();

    if devices.is_empty() {
        return Err(AudioError::ConfigError("No output devices found".to_string()));
    }

    println!("\nAvailable output devices:");
    for (idx, device) in devices.iter().enumerate() {
        let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        println!(" {}: {}", idx + 1, name);
    }

    print!("\nEnter device number to use: ");
    std::io::stdout().flush()?;

    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    let choice: usize = input
        .trim()
        .parse()
        .map_err(|_| AudioError::ConfigError("Invalid device number".to_string()))?;

    if choice == 0 || choice > devices.len() {
        return Err(AudioError::ConfigError(format!(
            "Device number out of range (1-{})",
            devices.len()
        )));
    }

    Ok(devices[choice - 1].clone())
}

pub fn select_device_by_number(num: usize) -> Result<cpal::Device, AudioError> {
    let host = cpal::default_host();
    let devices: Vec<_> = host
        .output_devices()
        .map_err(|e| AudioError::OutputError(e.to_string()))?
        .collect();

    if num == 0 || num > devices.len() {
        return Err(AudioError::ConfigError(format!(
            "Device number out of range (1-{})",
            devices.len()
        )));
    }

    Ok(devices[num - 1].clone())
}

pub fn find_best_config(
    device: &cpal::Device,
    channels: u16,
) -> Result<cpal::SupportedStreamConfig, Box<dyn std::error::Error>> {
    let configs: Vec<_> = device.supported_output_configs()?.collect();

    for config in configs.iter() {
        if config.channels() == channels && config.sample_format() == cpal::SampleFormat::F32 {
            return Ok(config.with_max_sample_rate());
        }
    }

    for config in configs {
        if config.channels() == channels {
            return Ok(config.with_max_sample_rate());
        }
    }

    Err("No matching output configuration found".into())
}
