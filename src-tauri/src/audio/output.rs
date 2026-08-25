use crate::error::AudioError;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub struct AudioOutput {
	#[allow(dead_code)]
	stream: cpal::Stream,
}

impl AudioOutput {
	pub fn start(
		config: &cpal::StreamConfig,
		device: &cpal::Device,
		mut data_callback: impl FnMut(&mut [f32]) + Send + 'static,
	) -> Result<Self, AudioError> {
		let stream = device
			.build_output_stream(
				config,
				move |data: &mut [f32], _| {
					data_callback(data);
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

		Ok(Self { stream })
	}
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
