use std::fmt;

#[derive(Debug, serde::Serialize)]
pub enum AudioError {
    DecodingError(String),
    OutputError(String),
    FileError(String),
    ConfigError(String),
}

impl fmt::Display for AudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AudioError::DecodingError(msg) => write!(f, "Decoding error: {}", msg),
            AudioError::OutputError(msg) => write!(f, "Audio output error: {}", msg),
            AudioError::FileError(msg) => write!(f, "File error: {}", msg),
            AudioError::ConfigError(msg) => write!(f, "Configuration error: {}", msg),
        }
    }
}

impl std::error::Error for AudioError {}

impl From<std::io::Error> for AudioError {
    fn from(e: std::io::Error) -> Self {
        AudioError::ConfigError(e.to_string())
    }
}