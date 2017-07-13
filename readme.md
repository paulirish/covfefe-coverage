# covfefe-coverage

_(very early)_

Access the DevTools JavaScript Coverage Profiler data.

![image](https://user-images.githubusercontent.com/39191/28147058-c3b15b70-6732-11e7-8b82-477324db0699.png)

Right now this script is a little proof of concept, but it does sit on top of:

* `chrome-devtools-frontend` for calculation of metrics.
* `chrome-remote-interface` because ya gotta
* `chrome-launcher` for the launch
* `devtools-protocol` for declarative protocol JSON

Interestingly, this is the first time we've had devtools frontend's `Target` and `TargetManager` working well with a chrome-remote-interface target. There's aspects to be improved but it's quite exciting nonetheless.
