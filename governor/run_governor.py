from experiment.governor_loop import GovernorLoop
import time

g = GovernorLoop(mode='reactive')
g.start()
time.sleep(180)
g.stop()
