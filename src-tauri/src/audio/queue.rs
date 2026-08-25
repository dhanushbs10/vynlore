use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

struct QueueState {
	data: VecDeque<f32>,
	capacity: usize,
	closed: bool,
}

pub struct SampleQueue {
	state: Mutex<QueueState>,
	not_full: Condvar,
	not_empty: Condvar,
}

impl SampleQueue {
	pub fn new(capacity_samples: usize) -> Self {
		Self {
			state: Mutex::new(QueueState {
				data: VecDeque::with_capacity(capacity_samples),
				capacity: capacity_samples,
				closed: false,
			}),
			not_full: Condvar::new(),
			not_empty: Condvar::new(),
		}
	}

	pub fn push_all(&self, samples: &[f32]) -> bool {
		let mut state = self.state.lock().unwrap();
		let mut offset = 0;
		loop {
			if state.closed {
				return false;
			}
			while offset < samples.len() && state.data.len() < state.capacity {
				let room = state.capacity - state.data.len();
				let take = room.min(samples.len() - offset);
				let end = offset + take;
				state.data.extend(&samples[offset..end]);
				offset = end;
				self.not_empty.notify_all();
			}
			if offset >= samples.len() {
				return true;
			}
			let (guard, _timeout) = self
				.not_full
				.wait_timeout(state, Duration::from_millis(100))
				.unwrap();
			state = guard;
		}
	}

	pub fn pop_available(&self, out: &mut [f32]) -> usize {
		let mut state = self.state.lock().unwrap();
		let written = state.data.len().min(out.len());
		for slot in out.iter_mut().take(written) {
			*slot = state.data.pop_front().unwrap();
		}
		if written > 0 {
			self.not_full.notify_all();
		}
		written
	}

	pub fn is_empty(&self) -> bool {
		self.state.lock().unwrap().data.is_empty()
	}

	pub fn clear(&self) {
		let mut state = self.state.lock().unwrap();
		state.data.clear();
		self.not_full.notify_all();
	}

	pub fn close(&self) {
		let mut state = self.state.lock().unwrap();
		state.closed = true;
		self.not_full.notify_all();
		self.not_empty.notify_all();
	}
}
